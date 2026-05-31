from langchain_ollama import ChatOllama

llm = ChatOllama(
    model="qwen2.5-coder:7b",
    temperature=0,
)

def ai_review(code):

    prompt = f"""
You are a strict senior software engineer performing a real code review.

RULES:
- Only review the provided code
- Do not invent fake issues
- Do not hallucinate
- Do not give generic advice
- Do not explain theory
- Only mention real issues
- If no issue exists say:
No major issue found

FORMAT:

BUGS
- [SEVERITY] Title
Problem:
Explanation

Fixed Code:
<fixed code>

SECURITY ISSUES
- [SEVERITY] Title
Problem:
Explanation

PERFORMANCE ISSUES
- [SEVERITY] Title
Problem:
Explanation

CODE QUALITY
- [SEVERITY] Title
Problem:
Explanation

BEST PRACTICES
- short bullet points

CODE TO REVIEW:

{code}
"""

    response = llm.invoke(prompt)

    return response.content