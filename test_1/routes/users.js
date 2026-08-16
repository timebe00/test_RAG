const express = require("express");

const { Ollama } = require("@langchain/ollama");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

const { searchUserKnowledge } = require(base + "/lib/userKnowledge");

const router = express.Router();

// 요청을 받아 사용자별 PDF 지식에서 답을 생성한다.
async function answerQuestion(req, res) {
  const { userID } = req.params;
  const question = String(req.body.question || req.query.question || "").trim();

  if (!question) {
    return res.status(400).json({ error: "question is required." });
  }

  try {
    // 질문과 가장 관련 높은 청크만 골라 컨텍스트로 사용한다.
    const topChunks = await searchUserKnowledge(userID, question, 5);
    const context = topChunks.map((chunk) => chunk.pageContent).join("\n\n");

    // 컨텍스트 밖의 내용은 답하지 않도록 모델 지시문을 고정한다.
    const prompt = ChatPromptTemplate.fromTemplate(`
Answer only from the reference context below.
If the context does not contain the answer, say you do not know.
Always answer in Korean.

Reference context:
{context}

Question:
{question}
`);
    const model = new Ollama({ model: "gemma4:26b" });
    const answer = await prompt.pipe(model).pipe(new StringOutputParser()).invoke({ context, question });

    return res.json({
      userID,
      question,
      answer,
      // 어떤 PDF를 참고했는지 응답에 같이 내려준다.
      sources: [...new Set(topChunks.map((chunk) => chunk.metadata?.fileName).filter(Boolean))],
    });
  } catch (error) {
    if (error.status === 400 || error.status === 404) {
      return res.status(error.status).json({ error: error.message });
    }

    console.error(`RAG failed for user ${userID}:`, error);
    return res.status(500).json({ error: "질문 처리 중 서버 오류가 발생했습니다." });
  }
}

// GET과 POST 둘 다 지원해서 프론트에서 쓰기 편하게 한다.
router.get("/:userID", answerQuestion);
router.post("/:userID", answerQuestion);

module.exports = router;
