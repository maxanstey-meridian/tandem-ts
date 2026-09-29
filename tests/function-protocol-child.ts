import { inspectAccepted, run, type ChatClient } from "@maxanstey-meridian/tandem";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPipeline } from "../examples/code-writer/typescript/src/pipeline.js";
import {
  startFakeOpenAi,
  writeChatCompletion,
  writeModels,
  writeNotFound,
  writeResponse,
} from "./support/fake-openai.mjs";

const sources = [
  `(input) => input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")`,
  `(input) => input.trim().toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")`,
  `function slugify(input) { return input.trim().toLowerCase().normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, ""); }`,
];
const reviews = [
  {
    decision: "RequestChanges",
    summary: "Correct behavior, but improve maintainability.",
    findings: ["Use a named function expression so the implementation is self-identifying."],
  },
  { decision: "Accept", summary: "The slugify implementation is accepted.", findings: [] },
];
let implementerVisit = 0;
let reviewerVisit = 0;

const directory = mkdtempSync(join(tmpdir(), "tandem-function-protocol-"));
const ledgerPath = join(directory, "function.sqlite3");
const server = await startFakeOpenAi(({ url }, response) => {
  if (url === "/v1/models") return writeModels(response, "gpt-5.6-sol");
  if (url === "/v1/chat/completions") {
    implementerVisit += 1;
    return writeChatCompletion(response, {
      toolCall: {
        name: "submit_implementation",
        arguments: {
          implementation: sources[implementerVisit - 1],
          rationale: `Implementation revision ${implementerVisit}`,
        },
      },
    });
  }
  if (url === "/v1/responses") {
    return writeResponse(response, JSON.stringify(reviews[Math.min(reviewerVisit++, 1)]));
  }
  writeNotFound(response);
});
const endpoint = server.url;
const implementer: ChatClient = {
  kind: "openai-compatible",
  version: 1,
  endpoint,
  model: "fixture-ds4",
  wireApi: "completions",
};
const reviewer: ChatClient = {
  kind: "openai-compatible",
  version: 1,
  endpoint,
  model: "gpt-5.6-sol",
  wireApi: "responses",
  verifyModel: true,
};

try {
  const result = await run(
    createPipeline({ implementer, reviewer }),
    {
      requirements: [
        "Implement synchronous pure JavaScript slugify(input).",
        "Trim whitespace, lowercase, remove Unicode diacritics, collapse non-alphanumeric runs to one hyphen, trim edge hyphens, and return empty when no alphanumeric remains.",
      ],
      implementation: null,
      verification: null,
      review: null,
    },
    { ledgerPath },
  );
  const accepted = await inspectAccepted({ ledgerPath, runId: result.runId });
  console.log(JSON.stringify({ result, accepted, requests: server.requests }));
} catch (error) {
  console.error(JSON.stringify(server.requests));
  throw error;
} finally {
  await server.close();
  rmSync(directory, { recursive: true, force: true });
}
