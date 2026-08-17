const { preloadSelectedUserKnowledge } = require("../lib/userKnowledge");

function parseTargetUserIDs(argv) {
  const userIDs = [];

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === "--user" || value === "-u") {
      const nextValue = argv[index + 1];
      if (nextValue) {
        userIDs.push(nextValue);
        index += 1;
      }
      continue;
    }

    if (value.startsWith("--user=")) {
      userIDs.push(value.slice("--user=".length));
      continue;
    }

    // 그 외 값은 모두 userID로 간주한다.
    if (!value.startsWith("-")) {
      userIDs.push(value);
    }
  }

  return userIDs;
}

async function main() {
  try {
    const userIDs = parseTargetUserIDs(process.argv.slice(2));

    // 인자가 없으면 전체 사용자, 인자가 있으면 지정한 사용자만 준비한다.
    const results = await preloadSelectedUserKnowledge(userIDs);

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
