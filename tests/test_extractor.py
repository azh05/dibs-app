"""Extractor tests with a fake client returning real SDK Message objects."""
from datetime import date

from anthropic.types import Message

from app.extractor import RECORD_TOOL_NAME, DealExtractor, record_tool_definition
from app.schemas import DealStatus, SearchRequest

TODAY = date(2026, 10, 23)
IG = "https://www.instagram.com/p/milksha123/"


def msg(content, stop_reason="end_turn", searches=0):
    return Message.model_validate(
        {
            "id": "msg_test",
            "type": "message",
            "role": "assistant",
            "model": "test-model",
            "content": content,
            "stop_reason": stop_reason,
            "stop_sequence": None,
            "usage": {"input_tokens": 100, "output_tokens": 50, "server_tool_use": {"web_search_requests": searches, "web_fetch_requests": 0}},
        }
    )


SEARCH_BLOCKS = [
    {"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": {"query": "Westwood boba deal"}},
    {
        "type": "web_search_tool_result",
        "tool_use_id": "srvtoolu_1",
        "content": [
            {"type": "web_search_result", "url": IG, "title": "Milksha CA", "page_age": "October 2, 2026", "encrypted_content": "enc"},
        ],
    },
]

GOOD_DEAL = {
    "shop_name": "Milksha Westwood",
    "offer": "Buy 1 drink, get the 2nd 50% off",
    "code": "BOGO50",
    "conditions": ["in-store only"],
    "end_date": "2026-10-31",
    "source_url": IG,
    "verbatim_quote": "Buy 1 drink and get the second 50% off, code BOGO50, all October long",
    "confidence": "high",
}


def record_block(deals):
    return {"type": "tool_use", "id": "toolu_1", "name": RECORD_TOOL_NAME, "input": {"deals": deals}}


class FakeMessages:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0)


class FakeClient:
    def __init__(self, responses):
        self.messages = FakeMessages(responses)


def run(responses, req=None):
    client = FakeClient(responses)
    out = DealExtractor(client=client, model="test-model").search(req or SearchRequest(), today=TODAY)
    return out, client.messages.calls


def test_single_turn_search_and_record():
    out, calls = run([msg(SEARCH_BLOCKS + [record_block([GOOD_DEAL])], stop_reason="tool_use", searches=1)])
    assert len(calls) == 1
    assert out.queries == ["Westwood boba deal"]
    assert out.usage.web_search_requests == 1
    assert len(out.deals) == 1 and out.deals[0].status == DealStatus.live
    assert out.deals[0].code == "BOGO50"


def test_request_shape():
    req = SearchRequest(max_searches=3, allowed_domains=["instagram.com"], shop="Milksha Westwood")
    _, calls = run([msg(SEARCH_BLOCKS + [record_block([])], stop_reason="tool_use")], req)
    web, record = calls[0]["tools"]
    assert web["type"] == "web_search_20250305" and web["max_uses"] == 3
    assert web["allowed_domains"] == ["instagram.com"]
    assert web["user_location"]["city"] == "Los Angeles"
    assert record["name"] == RECORD_TOOL_NAME
    assert "$ref" not in str(record["input_schema"])
    assert "Milksha Westwood" in calls[0]["messages"][0]["content"]
    assert "2026-10-23" in calls[0]["messages"][0]["content"]


def test_prose_answer_forces_tool_next_turn():
    first = msg(SEARCH_BLOCKS + [{"type": "text", "text": "I found a Milksha deal."}], searches=1)
    second = msg([record_block([GOOD_DEAL])], stop_reason="tool_use")
    out, calls = run([first, second])
    assert len(calls) == 2
    assert calls[1]["tool_choice"] == {"type": "tool", "name": RECORD_TOOL_NAME}
    # Assistant turn sent back with the search blocks intact, then the nudge.
    sent_back = calls[1]["messages"][1]
    assert sent_back["role"] == "assistant"
    assert sent_back["content"][1]["content"][0]["encrypted_content"] == "enc"
    assert calls[1]["messages"][2]["role"] == "user"
    assert len(out.deals) == 1


def test_pause_turn_resends_without_nudge():
    first = msg(SEARCH_BLOCKS, stop_reason="pause_turn", searches=1)
    second = msg([record_block([GOOD_DEAL])], stop_reason="tool_use")
    out, calls = run([first, second])
    assert calls[1]["tool_choice"] == {"type": "auto"}
    assert calls[1]["messages"][-1]["role"] == "assistant"
    assert len(out.deals) == 1


def test_hallucinated_source_rejected():
    bad = {**GOOD_DEAL, "source_url": "https://instagram.com/p/not-in-results"}
    out, _ = run([msg(SEARCH_BLOCKS + [record_block([bad])], stop_reason="tool_use")])
    assert not out.deals
    assert out.rejected[0].reason == "source_not_in_search_results"


def test_unparseable_date_cleared_not_guessed():
    weird = {**GOOD_DEAL, "end_date": "end of October"}
    out, _ = run([msg(SEARCH_BLOCKS + [record_block([weird])], stop_reason="tool_use")])
    assert out.deals[0].end_date is None
    assert any("cleared unparseable end_date" in e for e in out.search_errors)


def test_malformed_deal_dropped_with_error():
    out, _ = run([msg(SEARCH_BLOCKS + [record_block([{"shop_name": "X"}])], stop_reason="tool_use")])
    assert not out.deals
    assert any("dropped malformed deal from X" in e for e in out.search_errors)


def test_search_error_reported():
    blocks = [
        {"type": "server_tool_use", "id": "srvtoolu_1", "name": "web_search", "input": {"query": "q"}},
        {"type": "web_search_tool_result", "tool_use_id": "srvtoolu_1", "content": {"type": "web_search_tool_result_error", "error_code": "too_many_requests"}},
        record_block([]),
    ]
    out, _ = run([msg(blocks, stop_reason="tool_use")])
    assert "web search error: too_many_requests" in out.search_errors


def test_gives_up_after_max_turns():
    prose = lambda: msg([{"type": "text", "text": "no tool"}])
    out, calls = run([prose(), prose(), prose(), prose()])
    assert len(calls) == 4
    assert "Claude never called record_deals" in out.search_errors


def test_record_tool_schema_is_self_contained():
    schema = record_tool_definition()["input_schema"]
    item = schema["properties"]["deals"]["items"]
    assert "verbatim_quote" in item["required"] and "source_url" in item["required"]
    assert "$defs" not in item
