from __future__ import annotations

import json
import re

import anthropic

from protocol import Segment

LLM_MODEL = "claude-haiku-4-5-20251001"

GLOSSARY = "Rust, Graydon Hoare, Mozilla, Ownership, Garbage Collector, Memory Bug, Crash, Microsoft, Amazon, Google"

SYSTEM_PROMPT = f"""คุณเป็นผู้ตรวจแก้ transcript ภาษาไทยจาก speech-to-text

เนื้อหาเกี่ยวกับ: {GLOSSARY}

กฎ:
- แก้คำผิด ชื่อเฉพาะ และวรรคตอนให้ถูกต้อง
- ห้ามเปลี่ยนความหมายหรือเพิ่ม/ลด segment
- ตอบเป็น JSON array of strings เท่านั้น จำนวนเท่ากับ input เสมอ
- ถ้า segment ไหนดีอยู่แล้ว ให้คืนค่าเดิม"""


class Corrector:
    def __init__(self, model: str = LLM_MODEL) -> None:
        self._client: anthropic.Anthropic | None = None
        self._model = model

    def correct_batch(self, segments: list[Segment]) -> list[str]:
        texts = [s.text for s in segments]
        try:
            if self._client is None:
                self._client = anthropic.Anthropic()
            msg = self._client.messages.create(
                model=self._model,
                max_tokens=4096,
                system=SYSTEM_PROMPT,
                messages=[{"role": "user", "content": json.dumps(texts, ensure_ascii=False)}],
            )
            raw = msg.content[0].text.strip()
            m = re.search(r"\[.*\]", raw, re.DOTALL)
            corrected = json.loads(m.group() if m else raw)
            if isinstance(corrected, list) and len(corrected) == len(texts):
                return [str(t).strip() for t in corrected]
        except Exception as e:
            import sys
            sys.stderr.write(f"corrector error: {e}\n")
            sys.stderr.flush()
        return texts
