import json
import unittest
from unittest.mock import patch

from quiltor.infrastructure.inference.shared.contract import count_tokens, invoke_chat
from quiltor.modules.assistant.jobs import classify_assistant_error
from quiltor.modules.assistant.ports import InferenceValidationError


class FakeResponse:
    def __init__(self, body, status=200):
        self._body, self.status = body, status

    def read(self):
        return json.dumps(self._body).encode()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class CountTokensTests(unittest.TestCase):
    def test_returns_the_real_token_count_from_the_runtime_tokenizer(self):
        with patch(
            "quiltor.infrastructure.inference.shared.contract.urllib.request.urlopen",
            return_value=FakeResponse({"tokens": [1, 2, 3, 4, 5]}),
        ) as urlopen:
            result = count_tokens("http://mock", "hallo welt")
        self.assertEqual(result, 5)
        request = urlopen.call_args[0][0]
        self.assertEqual(request.full_url, "http://mock/tokenize")
        self.assertEqual(json.loads(request.data), {"content": "hallo welt"})

    def test_unreachable_runtime_raises_a_runtime_error(self):
        import urllib.error

        with patch(
            "quiltor.infrastructure.inference.shared.contract.urllib.request.urlopen",
            side_effect=urllib.error.URLError("refused"),
        ):
            with self.assertRaises(RuntimeError):
                count_tokens("http://mock", "hallo")

    def test_malformed_response_raises_a_runtime_error(self):
        with patch(
            "quiltor.infrastructure.inference.shared.contract.urllib.request.urlopen",
            return_value=FakeResponse({"unexpected": "shape"}),
        ):
            with self.assertRaises(InferenceValidationError) as caught:
                count_tokens("http://mock", "hallo")
        self.assertEqual(classify_assistant_error(caught.exception), "validation_error")

    def test_validation_classification_does_not_depend_on_diagnostic_wording(self):
        self.assertEqual(
            classify_assistant_error(InferenceValidationError("Unexpected payload shape")),
            "validation_error",
        )


# T-399 (F-R2-1): llama-server answers a step it cannot parse with a 500 of its own. The text
# is the server's, quoted as it arrives in the error body.
PEG_FORMAT_500 = {
    "error": {
        "code": 500,
        "message": "The model produced output that does not match the expected peg-native format",
        "type": "server_error",
    }
}


def http_error(status, body):
    import io
    import urllib.error
    from email.message import Message

    return urllib.error.HTTPError(
        "http://mock/v1/chat/completions",
        status,
        "error",
        Message(),
        io.BytesIO(json.dumps(body).encode()),
    )


class PegFormatErrorTests(unittest.TestCase):
    def test_a_peg_format_500_is_an_invalid_structured_answer_not_a_server_failure(self):
        with patch(
            "quiltor.infrastructure.inference.shared.contract.urllib.request.urlopen",
            side_effect=http_error(500, PEG_FORMAT_500),
        ):
            with self.assertRaises(InferenceValidationError) as caught:
                invoke_chat("http://mock", {"messages": []})
        self.assertEqual(classify_assistant_error(caught.exception), "validation_error")
        self.assertIn("peg-native", str(caught.exception))

    def test_any_other_500_stays_an_http_error(self):
        from quiltor.infrastructure.inference.shared.contract import InferenceHTTPError

        other = {"error": {"code": 500, "message": "Internal error", "type": "server_error"}}
        with patch(
            "quiltor.infrastructure.inference.shared.contract.urllib.request.urlopen",
            side_effect=http_error(500, other),
        ):
            with self.assertRaises(InferenceHTTPError) as caught:
                invoke_chat("http://mock", {"messages": []})
        self.assertNotIsInstance(caught.exception, InferenceValidationError)
        self.assertEqual(caught.exception.status, 500)


class InvokeChatTests(unittest.TestCase):
    def test_invalid_runtime_payload_preserves_the_validation_failure_code(self):
        for body in (
            {"unexpected": "shape"},
            {"choices": [{"message": {"content": "not JSON"}, "finish_reason": "stop"}]},
        ):
            with self.subTest(body=body):
                with patch(
                    "quiltor.infrastructure.inference.shared.contract.urllib.request.urlopen",
                    return_value=FakeResponse(body),
                ):
                    with self.assertRaises(InferenceValidationError) as caught:
                        invoke_chat("http://mock", {"messages": []})
                self.assertEqual(classify_assistant_error(caught.exception), "validation_error")

    def test_parses_the_structured_json_content_from_the_chat_completion(self):
        body = {
            "choices": [
                {
                    "message": {
                        "content": json.dumps({"message": "hi", "citations": [], "proposals": []})
                    }
                }
            ]
        }
        with patch(
            "quiltor.infrastructure.inference.shared.contract.urllib.request.urlopen",
            return_value=FakeResponse(body),
        ):
            result = invoke_chat("http://mock", {"messages": []})
        self.assertEqual(result, {"message": "hi", "citations": [], "proposals": []})

    def test_optionally_returns_runtime_usage_without_changing_the_default_contract(self):
        body = {
            "choices": [
                {"finish_reason": "stop", "message": {"content": json.dumps({"message": "hi"})}}
            ],
            "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15},
        }
        with patch(
            "quiltor.infrastructure.inference.shared.contract.urllib.request.urlopen",
            return_value=FakeResponse(body),
        ):
            result = invoke_chat("http://mock", {"messages": []}, include_metadata=True)
        self.assertEqual(result["message"], "hi")
        self.assertEqual(result["_runtime"]["finishReason"], "stop")
        self.assertEqual(result["_runtime"]["promptTokens"], 12)
        self.assertEqual(result["_runtime"]["completionTokens"], 3)
        self.assertEqual(result["_runtime"]["totalTokens"], 15)
        self.assertIsInstance(result["_runtime"]["durationMs"], int)


if __name__ == "__main__":
    unittest.main()
