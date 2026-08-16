const { preloadAllUserKnowledge } = require("../lib/userKnowledge");

async function main() {
  try {
    // 실제 서비스 시작 전에 임베딩 캐시를 미리 만들어 둔다.
    const results = await preloadAllUserKnowledge();

    if (results.length === 0) {
      console.log("No PDF sources were found.");
      return;
    }

    for (const result of results) {
      console.log(`Prepared ${result.userID}: ${result.chunks} chunks`);
    }
  } catch (error) {
    // 준비 단계에서 실패하면 원인을 바로 보이도록 종료 코드를 남긴다.
    console.error("Failed to prepare RAG cache:", error);
    process.exitCode = 1;
  }
}

main();
