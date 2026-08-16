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

// userID 값은 경로 조작을 막기 위해 허용 문자만 통과시킨다.
function assertValidUserID(userID) {
  if (!/^[a-zA-Z0-9_-]+$/.test(userID)) {
    const error = new Error("Invalid userID.");
    error.status = 400;
    throw error;
  }
}

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

// userID 폴더 아래의 PDF를 전부 재귀적으로 수집한다.
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

  return nestedSources.flat().sort((left, right) => left.filePath.localeCompare(right.filePath));
}

// 새 폴더 구조와 예전 단일 PDF 구조를 둘 다 지원한다.
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

// PDF를 읽어 텍스트 메타데이터를 붙인 뒤, 청크 단위로 사용할 준비를 한다.
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

// 청크 생성과 임베딩 생성은 최초 1회만 수행하고 캐시에 저장한다.
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

// 디스크 캐시가 현재 PDF 목록과 정확히 일치하는지 확인한다.
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

// 캐시 파일이 유효하면 그대로 재사용하고, 아니면 null을 반환한다.
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

// 임베딩 결과를 JSON 캐시로 저장해 다음 요청에서 재사용한다.
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

// 캐시가 없거나 오래됐으면 PDF를 다시 읽어서 임베딩을 만든다.
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

// 같은 userID에 대한 동시 요청은 하나의 로딩 작업을 공유한다.
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

// 질문과 가장 비슷한 청크를 고른 뒤, 모델에 넣을 컨텍스트를 만든다.
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

// 배치 준비용으로 현재 PDF가 있는 userID를 모두 찾는다.
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

// 서비스 시작 전 미리 돌리면 최초 응답 지연을 줄일 수 있다.
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

module.exports = {
  getUserKnowledge,
  listKnownUserIDs,
  preloadAllUserKnowledge,
  searchUserKnowledge,
};
