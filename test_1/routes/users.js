const express = require("express");

const { Ollama } = require("@langchain/ollama");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { ChatPromptTemplate } = require("@langchain/core/prompts");

const { searchUserKnowledge } = require(base + "/lib/userKnowledge");

const router = express.Router();

// 한 사용자에 대한 질문 한 건을 처리한다.
// 해당 사용자의 PDF만 조회하고, 가장 관련 높은 청크를 고른 뒤,
// 그 청크를 모델의 근거 컨텍스트로 넘긴다.
async function answerQuestion(req, res) {
  const { userID } = req.params;
  const question = String(req.body.question || req.query.question || "").trim();

  if (!question) {
    return res.status(400).json({ error: "question is required." });
  }

  try {
    // 사용자 캐시에서 질문과 가장 관련 높은 청크를 가져온다.
    const topChunks = await searchUserKnowledge(userID, question, 5);
    const context = topChunks.map((chunk) => chunk.pageContent).join("\n\n");

    // 모델이 제공된 컨텍스트 밖의 내용을 섞지 않도록 프롬프트를 엄격하게 유지한다.
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
      // 답변을 만들 때 참고한 PDF 파일명을 함께 내려줘서 디버깅하기 쉽게 한다.
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

// 프론트에서 쓰기 편하도록 GET과 POST를 둘 다 지원한다.
router.get("/:userID", answerQuestion);
router.post("/:userID", answerQuestion);


module.exports = router;
