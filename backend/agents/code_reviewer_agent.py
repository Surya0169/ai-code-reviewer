from langchain_ollama import ChatOllama

llm = ChatOllama(
    model="qwen2.5-coder:7b",
    temperature=0,
)

def ai_review(code):

    prompt = f"""
You are a professional senior software engineer.

Review the code carefully.

STRICT RULES:
- Only report REAL issues
- Do NOT hallucinate
- Do NOT invent problems
- Do NOT explain unnecessary theory
- Keep response SHORT and CLEAN
- If no issues exist, say:
No major issues found.

OUTPUT FORMAT:

## Bugs
- [HIGH] Example issue
  Fix: short fix

## Security
- [MEDIUM] Example issue
  Fix: short fix

## Performance
- [LOW] Example issue
  Fix: short fix

## Code Quality
- [LOW] Example issue
  Fix: short fix

## Best Practices
- short bullet points only

## Summary
Critical: X
High: X
Medium: X
Low: X

CODE:
{code}
"""

    response = llm.invoke(prompt)

    return response.content