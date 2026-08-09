import json
import unittest
from unittest.mock import patch

from backend.llm.shared.contract import count_tokens, invoke_chat


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
        with patch("backend.llm.shared.contract.urllib.request.urlopen", return_value=FakeResponse({"tokens": [1, 2, 3, 4, 5]})) as urlopen:
            result = count_tokens("http://mock", "hallo welt")
        self.assertEqual(result, 5)
        request = urlopen.call_args[0][0]
        self.assertEqual(request.full_url, "http://mock/tokenize")
        self.assertEqual(json.loads(request.data), {"content": "hallo welt"})

    def test_unreachable_runtime_raises_a_runtime_error(self):
        import urllib.error
        with patch("backend.llm.shared.contract.urllib.request.urlopen", side_effect=urllib.error.URLError("refused")):
            with self.assertRaises(RuntimeError):
                count_tokens("http://mock", "hallo")

    def test_malformed_response_raises_a_runtime_error(self):
        with patch("backend.llm.shared.contract.urllib.request.urlopen", return_value=FakeResponse({"unexpected": "shape"})):
            with self.assertRaises(RuntimeError):
                count_tokens("http://mock", "hallo")


class InvokeChatTests(unittest.TestCase):
    def test_parses_the_structured_json_content_from_the_chat_completion(self):
        body = {"choices": [{"message": {"content": json.dumps({"message": "hi", "citations": [], "proposals": []})}}]}
        with patch("backend.llm.shared.contract.urllib.request.urlopen", return_value=FakeResponse(body)):
            result = invoke_chat("http://mock", {"messages": []})
        self.assertEqual(result, {"message": "hi", "citations": [], "proposals": []})

    def test_optionally_returns_runtime_usage_without_changing_the_default_contract(self):
        body = {
            "choices": [{"finish_reason": "stop", "message": {"content": json.dumps({"message": "hi"})}}],
            "usage": {"prompt_tokens": 12, "completion_tokens": 3, "total_tokens": 15},
        }
        with patch("backend.llm.shared.contract.urllib.request.urlopen", return_value=FakeResponse(body)):
            result = invoke_chat("http://mock", {"messages": []}, include_metadata=True)
        self.assertEqual(result["message"], "hi")
        self.assertEqual(result["_runtime"]["finishReason"], "stop")
        self.assertEqual(result["_runtime"]["promptTokens"], 12)
        self.assertEqual(result["_runtime"]["completionTokens"], 3)
        self.assertEqual(result["_runtime"]["totalTokens"], 15)
        self.assertIsInstance(result["_runtime"]["durationMs"], int)


if __name__ == "__main__":
    unittest.main()
