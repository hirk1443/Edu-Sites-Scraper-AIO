import mockttp from "mockttp";
import ora from "ora";

const cert = await mockttp.generateCACertificate();

const spinner = ora("Starting proxy server...").start();
const proxy = mockttp.getLocal({ https: cert });
proxy.forUnmatchedRequest().thenPassThrough();
proxy.start(8080)

spinner.succeed("Started proxy server at http://localhost:8080");

export { proxy };
