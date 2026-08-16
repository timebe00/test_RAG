var express = require('express');
var router = express.Router();

// 1. 에러를 유발하는 랭체인 벡터스토어를 제외하고, Ollama와 기초 패키지만 로드
const { Ollama, OllamaEmbeddings } = require("@langchain/ollama");
const { StringOutputParser } = require("@langchain/core/output_parsers");
const { ChatPromptTemplate } = require("@langchain/core/prompts");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");
const { default: axios } = require('axios');

const { sendMessage } = require(base + "/lib/sendTelegram");

// 전역 변수로 분할된 문서들과 그에 대응하는 임베딩 벡터 배열을 저장
let savedDocs = [];
let savedEmbeddings = [];

// 코사인 유사도(Cosine Similarity) 계산 함수 직접 구현 (에러 원천 차단)
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 2. RAG 시스템 초기화 함수
async function initRAG() {
  console.log("RAG 시스템 초기화 중... PDF 로딩 시작");
  try {
    const loader = new PDFLoader(base + "/public/pdf/test.pdf");
    const rawDocs = await loader.load();

    const textSplitter = new RecursiveCharacterTextSplitter({
      chunkSize: 500,
      chunkOverlap: 100,
    });
    savedDocs = await textSplitter.splitDocuments(rawDocs);

    // 문서들의 임베딩 추출
    const embeddings = new OllamaEmbeddings({ model: "nomic-embed-text" });
    
    console.log("문서 임베딩 생성 중...");
    // 각 텍스트 조각마다 Ollama를 통해 벡터 값을 추출하여 배열에 저장
    for (const doc of savedDocs) {
      const vec = await embeddings.embedQuery(doc.pageContent);
      savedEmbeddings.push({ doc: doc, embedding: vec });
    }
    
    console.log(`RAG 시스템 준비 완료! 총 ${savedDocs.length}개 조각 로드 및 임베딩 완료.`);
  } catch (error) {
    console.error("RAG 초기화 실패:", error);
  }
}

// 서버 시작 시 실행
initRAG();



/* GET home page. */
router.get('/', async function(req, res, next) {
  const question = "개인정보 보호법 제 1조에 대해서 설명해줘"

   if (savedEmbeddings.length === 0) {
    return res.status(503).json({ error: "RAG 시스템이 아직 준비되지 않았습니다." });
  }

  try {
    const embeddings = new OllamaEmbeddings({ model: "nomic-embed-text" });
    const model = new Ollama({ model: "gemma4:26b" });

    // 유저의 질문을 벡터로 변환
    const queryVector = await embeddings.embedQuery(question);

    // 모든 문서 조각과의 유사도를 계산하여 점수 매기기
    const scoredDocs = savedEmbeddings.map(item => {
      const score = cosineSimilarity(queryVector, item.embedding);
      return { doc: item.doc, score: score };
    });

    // 유사도 점수가 높은 순으로 정렬 후 상위 3개 조각 선택
    scoredDocs.sort((a, b) => b.score - a.score);
    const topDocs = scoredDocs.slice(0, 3).map(item => item.doc);

    // 컨텍스트 병합
    const context = topDocs.map(d => d.pageContent).join("\n\n");

    const prompt = ChatPromptTemplate.fromTemplate(`
답변은 아래 참고 자료를 바탕으로 질문에 친절하게 대답해줘.
답변은 항상 한글로 답변해줘
참고 자료: {context}
질문: {question}
`);

    const chain = prompt.pipe(model).pipe(new StringOutputParser());
    const response = await chain.invoke({
      context,
      question
    });

    res.json({ 
      question, 
      answer: response 
    });

  } catch (error) {
    console.error("API 실행 중 에러 발생:", error);
    res.status(500).json({ error: "서버 내부 에러가 발생했습니다." });
  }
});

/* GET home page. */
router.get('/sandMesTelegram', async function(req, res, next) {
  let test = await sendMessage("test_send");

  res.json({test : "test"})
});


module.exports = router;
