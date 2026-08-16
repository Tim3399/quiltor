"""What Quiltor is, independent of how it is run or shipped.

Worlds, chapters, figures, relationships, timeline moments, the snapshot history
and the retrieval corpus. Everything here is plain Python and SQLite over the
standard library.

The rule that makes this package worth having: **core knows nothing about the
operating system, the distribution channel, or the host.** It never imports
`backend/system/`, never imports `backend/edition/`, never imports a capability
(`llm/`, `language/`, `pdf/`), never imports `hosts/`, and never imports
`server`. Dependencies point inward, and this is the innermost ring.

That is checked, not merely stated -- see tests/backend/test_core.py. The same
mistake has already been made once in this codebase, when a platform layer
claimed in a docstring to be the only place branching on the OS and had thirteen
branches elsewhere by the time anyone looked.

Note what is deliberately *not* here. `backend/assistant/` orchestrates the LLM
capability and imports `backend.llm`, so it sits above core rather than inside
it -- putting it here would break the very rule this package exists to express.
`backend/auth.py` is OIDC for the hosted deployment and is likewise not domain.
"""
