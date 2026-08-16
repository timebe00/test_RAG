const { preloadAllUserKnowledge } = require("../lib/userKnowledge");

async function main() {
  try {
    // 앱이 실제 트래픽을 받기 전에 캐시를 미리 데운다.
    // 무거운 PDF 파싱과 임베딩 작업을 요청 경로 밖으로 빼내는 효과가 있다.
    const results = await preloadAllUserKnowledge();

    if (results.length === 0) {
      console.log("No PDF sources were found.");
      return;
    }

    for (const result of results) {
      console.log(`Prepared ${result.userID}: ${result.chunks} chunks`);
    }
  } catch (error) {
    // 준비 단계가 실패하면 종료 코드를 남겨 배포 스크립트가 실패를 감지하게 한다.
    console.error("Failed to prepare RAG cache:", error);
    process.exitCode = 1;
  }
}

main();
