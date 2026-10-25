from unittest.mock import AsyncMock

import pytest
from pydantic import ValidationError

from voice_agent.forms import REQUIRED_FIELDS, DemoForm, FormCommand, FormFields


def complete_fields(**changes):
    return FormFields(
        **({
            "child_name": "Trần Minh An", "child_birth_date": "10/01/2025",
            "child_sex": "Nam", "child_birth_place": "Bệnh viện Mẫu",
            "mother_name": "Nguyễn Thu An", "full_name": "Nguyễn Thu An",
            "relationship": "Mẹ", "address": "123 Đường Mẫu",
        } | changes)
    )


@pytest.mark.asyncio
async def test_birth_form_ocr_prefill_answers_corrections_and_confirmation():
    publish = AsyncMock()
    form = DemoForm(publish)
    await form.command(FormCommand(action="start", fields=FormFields(child_name="Trần Minh An"),
                                   sources={"child_name": "ocr"}))
    assert form.state.missing() == list(REQUIRED_FIELDS[1:])
    assert "KHAI SINH" in form.context()
    tools = {tool.info.name: tool for tool in form.tools()}
    update, confirm = tools["update_birth_form"], tools["confirm_birth_form"]
    await update(child_name="Trần Minh An")
    assert form.state.sources["child_name"] == "ocr"
    assert form.state.revision == 1
    assert "error" in await confirm()
    assert "error" in await update(child_birth_date="31/02/2025", mother_name="Do not apply")
    assert form.state.fields.mother_name == ""
    result = await update(**complete_fields().model_dump())
    assert result["fields"]["child_birth_date"] == "2025-01-10"
    assert result["sources"]["child_name"] == "ocr"
    assert result["sources"]["mother_name"] == "user"
    assert result["fields"]["father_name"] == ""
    await update(child_name="Trần Minh Anh")
    assert form.state.sources["child_name"] == "user"
    assert not form.state.missing()
    result = await confirm()
    assert result["confirmed"] and not result["active"] and result["visible"]
    assert form.context() == ""
    assert "error" in await update(address="Should not change")
    assert form.state.fields.address == "123 Đường Mẫu"
    publish.assert_awaited()


@pytest.mark.asyncio
async def test_reject_stale_browser_commands_and_keep_birth_draft_on_stop():
    form = DemoForm()
    await form.command(FormCommand(action="start", fields=FormFields(child_name="Trần Minh An")))
    with pytest.raises(ValueError, match="vừa thay đổi"):
        await form.command(FormCommand(action="stop", expected_revision=0))
    await form.command(FormCommand(action="stop", expected_revision=1))
    assert not form.state.active and form.state.fields.child_name == "Trần Minh An"
    assert DemoForm().state.fields.child_name == ""


@pytest.mark.asyncio
async def test_optional_parent_details_do_not_block_manual_confirmation():
    form = DemoForm()
    draft = complete_fields()
    result = await form.command(FormCommand(action="confirm", fields=draft))
    assert result["confirmed"] and result["fields"] == draft.model_dump()
    assert result["fields"]["father_name"] == ""
    assert result["fields"]["phone"] == ""
    assert result["fields"]["child_nationality"] == ""


def test_birth_form_validates_dates_sex_phone_and_unknown_fields():
    for value in ["2025-02-30", "9999-01-01", "10/2025", "yesterday"]:
        with pytest.raises(ValidationError):
            FormFields(child_birth_date=value)
    with pytest.raises(ValidationError):
        FormFields(child_sex="guess")
    with pytest.raises(ValidationError):
        FormFields(full_name="x" * 121)
    with pytest.raises(ValidationError):
        FormFields(request="This is not a generic support form")
    assert FormFields(child_sex="bé gái").child_sex == "Nữ"
    assert FormFields(phone="+84 (90) 123-4567").phone == "+84901234567"
    assert FormFields(mother_birth_date="1/2/1990").mother_birth_date == "1990-02-01"


@pytest.mark.asyncio
async def test_voice_tools_open_and_close_birth_form_without_mixing_roles():
    publish = AsyncMock()
    form = DemoForm(publish)
    tools = {tool.info.name: tool for tool in form.tools()}
    opened = await tools["open_birth_form"]()
    assert opened["visible"] and opened["active"]
    assert "child_birth_date" in opened["fields"] and "request" not in opened["fields"]
    await tools["update_birth_form"](mother_name="Nguyễn An")
    assert form.state.fields.child_name == "" and form.state.fields.full_name == ""
    closed = await tools["close_birth_form"]()
    assert not closed["visible"] and not closed["active"]
    assert closed["fields"]["mother_name"] == "Nguyễn An"
    reopened = await tools["open_birth_form"]()
    assert reopened["visible"] and reopened["fields"]["mother_name"] == "Nguyễn An"
    assert publish.await_count == 4
