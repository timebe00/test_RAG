const path = require("path");
const fs = require("fs/promises");

const { OllamaEmbeddings } = require("@langchain/ollama");
const { PDFLoader } = require("@langchain/community/document_loaders/fs/pdf");
const { RecursiveCharacterTextSplitter } = require("@langchain/textsplitters");

const PDF_ROOT = path.join(__dirname, "..", "public", "pdf");
const CACHE_ROOT = path.join(__dirname, "..", ".rag-cache");
const EMBEDDING_MODEL = "nomic-embed-text";
const CACHE_VERSION = 1;

const embeddings = new OllamaEmbeddings({ model: EMBEDDING_MODEL });
const knowledgeCache = new Map();

// userID는 파일 경로에 들어가므로 안전한 문자만 허용한다.
// 경로 탈출(path traversal)을 막고 PDF/캐시 조회를 예측 가능하게 유지하기 위한 장치다.
function assertValidUserID(userID) {
  if (!/^[a-zA-Z0-9_-]+$/.test(userID)) {
    const error = new Error("Invalid userID.");
    error.status = 400;
    throw error;
  }
}

// 지금 구조는 벡터DB 대신 메모리 기반으로 점수를 매기므로 코사인 유사도가 필요하다.
function cosineSimilarity(vecA, vecB) {
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let index = 0; index < vecA.length; index += 1) {
    dotProduct += vecA[index] * vecB[index];
    normA += vecA[index] * vecA[index];
    normB += vecB[index] * vecB[index];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

function getUserPdfRoot(userID) {
  assertValidUserID(userID);
  return path.join(PDF_ROOT, userID);
}

function getCachePath(userID) {
  assertValidUserID(userID);
  return path.join(CACHE_ROOT, `${userID}.json`);
}

// public/pdf/<userID>/ 아래의 PDF를 하위 폴더까지 재귀적으로 모두 모은다.
// 이렇게 하면 한 사용자에게 여러 PDF와 하위 폴더 구조를 함께 둘 수 있다.
async function collectPdfSources(dirPath) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nestedSources = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(dirPath, entry.name);

      if (entry.isDirectory()) {
        return collectPdfSources(fullPath);
      }

      if (!entry.isFile() || path.extname(entry.name).toLowerCase() !== ".pdf") {
        return [];
      }

      const stats = await fs.stat(fullPath);
      return [
        {
          filePath: fullPath,
          mtimeMs: stats.mtimeMs,
          size: stats.size,
        },
      ];
    }),
  );

  // 캐시 비교 결과가 실행할 때마다 흔들리지 않도록 정렬한다.
  return nestedSources.flat().sort((left, right) => left.filePath.localeCompare(right.filePath));
}

// 새 폴더 구조와 예전 단일 PDF 구조를 둘 다 지원한다.
// 새 구조:
//   public/pdf/<userID>/*.pdf
// 예전 구조:
//   public/pdf/<userID>.pdf
async function resolveUserPdfSources(userID) {
  const userPdfRoot = getUserPdfRoot(userID);

  try {
    const stats = await fs.stat(userPdfRoot);
    if (stats.isDirectory()) {
      return collectPdfSources(userPdfRoot);
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  const legacyPdf = path.join(PDF_ROOT, `${userID}.pdf`);
  try {
    const stats = await fs.stat(legacyPdf);
    return [
      {
        filePath: legacyPdf,
        mtimeMs: stats.mtimeMs,
        size: stats.size,
      },
    ];
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

// PDF를 읽어서 청크로 나누기 전에 출처 메타데이터를 붙인다.
// 나중에 어떤 PDF에서 나온 청크인지 추적할 수 있도록 메타데이터를 남겨둔다.
async function loadDocumentsFromSource(source) {
  const loader = new PDFLoader(source.filePath);
  const docs = await loader.load();

  return docs.map((doc) => ({
    pageContent: doc.pageContent,
    metadata: {
      ...doc.metadata,
      source: source.filePath,
      fileName: path.basename(source.filePath),
    },
  }));
}

// 문서를 더 작은 청크로 나누고 각 청크를 임베딩한다.
// 이 단계가 가장 비싸므로, 가능한 한 결과를 재사용하는 쪽이 중요하다.
async function buildKnowledgeFromSources(sources) {
  const rawDocuments = await Promise.all(sources.map(loadDocumentsFromSource));
  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 500,
    chunkOverlap: 100,
  });
  const chunks = await splitter.splitDocuments(rawDocuments.flat());

  return Promise.all(
    chunks.map(async (chunk) => ({
      pageContent: chunk.pageContent,
      metadata: chunk.metadata,
      embedding: await embeddings.embedQuery(chunk.pageContent),
    })),
  );
}

// 캐시에 저장된 파일 목록과 현재 파일 목록이 같은지 비교한다.
// 경로, 수정 시각, 크기를 함께 확인해야 파일이 바뀌었을 때 캐시를 무효화할 수 있다.
function isMatchingSources(cachedSources, currentSources) {
  if (!Array.isArray(cachedSources) || cachedSources.length !== currentSources.length) {
    return false;
  }

  return cachedSources.every((cachedSource, index) => {
    const currentSource = currentSources[index];
    return (
      cachedSource.filePath === currentSource.filePath &&
      cachedSource.mtimeMs === currentSource.mtimeMs &&
      cachedSource.size === currentSource.size
    );
  });
}

// 디스크에서 캐시 파일을 읽는다.
// 캐시가 없거나 깨졌거나 오래됐으면 null을 반환해서 나중에 다시 만들도록 한다.
async function readCachedKnowledge(userID, sources) {
  const cachePath = getCachePath(userID);

  try {
    const content = await fs.readFile(cachePath, "utf8");
    const payload = JSON.parse(content);

    if (
      payload.version !== CACHE_VERSION ||
      payload.embeddingModel !== EMBEDDING_MODEL ||
      !isMatchingSources(payload.sources, sources) ||
      !Array.isArray(payload.chunks)
    ) {
      return null;
    }

    return payload.chunks;
  } catch (error) {
    if (error.code === "ENOENT" || error.name === "SyntaxError") {
      return null;
    }

    throw error;
  }
}

// 임베딩된 청크를 저장해 다음 요청에서는 PDF 파싱과 임베딩을 건너뛰게 한다.
async function writeCachedKnowledge(userID, sources, chunks) {
  await fs.mkdir(CACHE_ROOT, { recursive: true });
  const cachePath = getCachePath(userID);
  const payload = {
    version: CACHE_VERSION,
    embeddingModel: EMBEDDING_MODEL,
    userID,
    updatedAt: new Date().toISOString(),
    sources,
    chunks,
  };

  await fs.writeFile(cachePath, JSON.stringify(payload), "utf8");
}

// 실제 로딩 흐름이다.
// 1. 사용자 PDF를 찾는다.
// 2. 캐시를 먼저 확인한다.
// 3. 캐시가 없거나 오래됐으면 다시 만들어 저장한다.
async function loadUserKnowledge(userID) {
  const sources = await resolveUserPdfSources(userID);

  if (sources.length === 0) {
    const error = new Error(`No PDF files found for ${userID}.`);
    error.status = 404;
    throw error;
  }

  const cachedKnowledge = await readCachedKnowledge(userID, sources);
  if (cachedKnowledge) {
    return cachedKnowledge;
  }

  const builtKnowledge = await buildKnowledgeFromSources(sources);
  await writeCachedKnowledge(userID, sources, builtKnowledge);
  return builtKnowledge;
}

// 같은 사용자에게 동시에 여러 요청이 들어올 수 있다.
// 이 캐시는 실행 중인 Promise를 저장해 같은 작업이 한 번만 돌도록 한다.
async function getUserKnowledge(userID) {
  if (!knowledgeCache.has(userID)) {
    const promise = loadUserKnowledge(userID).catch((error) => {
      knowledgeCache.delete(userID);
      throw error;
    });

    knowledgeCache.set(userID, promise);
  }

  return knowledgeCache.get(userID);
}

// 질문을 임베딩한 뒤 사용자 청크들과 비교해서 가장 관련 높은 결과를 돌려준다.
// 라우트는 이 결과를 LLM에 넣을 컨텍스트로 사용한다.
async function searchUserKnowledge(userID, question, topK = 5) {
  const knowledge = await getUserKnowledge(userID);
  const queryVector = await embeddings.embedQuery(question);

  return knowledge
    .map((item) => ({
      ...item,
      score: cosineSimilarity(queryVector, item.embedding),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, topK);
}

// 사전 임베딩 스크립트에서 사용한다.
// 현재 디스크에 PDF가 있는 userID를 모두 찾아낸다.
async function listKnownUserIDs() {
  const entries = await fs.readdir(PDF_ROOT, { withFileTypes: true });
  const userIDs = new Set();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      userIDs.add(entry.name);
      continue;
    }

    if (entry.isFile() && path.extname(entry.name).toLowerCase() === ".pdf") {
      userIDs.add(path.basename(entry.name, ".pdf"));
    }
  }

  return [...userIDs].sort();
}

// 앱이 실제 요청을 받기 전에 한 번 돌리면 캐시를 미리 데울 수 있다.
// 그러면 첫 요청에서 발생하는 무거운 임베딩 비용을 실제 트래픽에서 빼낼 수 있다.
async function preloadAllUserKnowledge() {
  const userIDs = await listKnownUserIDs();
  const results = [];

  for (const userID of userIDs) {
    const knowledge = await getUserKnowledge(userID);
    results.push({
      userID,
      chunks: knowledge.length,
    });
  }

  return results;
}

// 특정 userID만 미리 임베딩하고 싶을 때 사용하는 보조 함수다.
// 인자를 넘기면 해당 사용자만 준비하고, 비어 있으면 전체 준비와 같은 흐름으로 처리할 수 있다.
async function preloadSelectedUserKnowledge(targetUserIDs = []) {
  const userIDs = Array.isArray(targetUserIDs)
    ? [...new Set(targetUserIDs.map((userID) => String(userID).trim()).filter(Boolean))]
    : [];

  if (userIDs.length === 0) {
    return preloadAllUserKnowledge();
  }

  const results = [];

  for (const userID of userIDs) {
    const knowledge = await getUserKnowledge(userID);
    results.push({
      userID,
      chunks: knowledge.length,
    });
  }

  return results;
}

module.exports = {
  getUserKnowledge,
  listKnownUserIDs,
  preloadAllUserKnowledge,
  preloadSelectedUserKnowledge,
  searchUserKnowledge,
};
