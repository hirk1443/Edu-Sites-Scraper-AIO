import got, { Got, Response } from "got";
import CryptoJS from "crypto-js";
import ora from "ora";
import prompts from "prompts";
import pMap from "p-map";
import path from "path";

import {
  EncryptedPayload,
  AuthResponse,
  MasterExam,
  ExamInformation,
  ExamApiResponse,
  LogoutResponse,
} from "../types/bmc_type.js";
import { log } from "node:console";
import { pandocMetadata } from "../tools.js";
import {
  convertAnswersToHtml,
  convertExamDataToHtml,
  generatePdf,
} from "./helper/convertToPdf.js";

export const website = "bmc.io.vn";
const baseApiUrl = "https://api.bmc.io.vn/api/v2";
const SECRET_KEY = "lmf@123456789";

let authourization = "";

const apiClient: Got = got.extend({
  responseType: "json",
  hooks: {
    beforeRequest: [
      (options) => {
        if (authourization) {
          options.headers["Authorization"] = `Bearer ${authourization}`;
        }
      },
    ],
    afterResponse: [
      async (response: Response) => {
        const body = response.body as EncryptedPayload;
        const hasEncryptedProperty = "encrypted" in body;

        if (body && hasEncryptedProperty) {
          if (body.encrypted === true) {
            if (typeof body.data !== "string") {
              throw new Error("Encrypted data is not a string.");
            }
            const decryptedData = await decryptData(body.data);
            response.body = decryptedData;
          } else {
            response.body = body.data;
          }
        } else {
        }
        return response;
      },
    ],
  },
});

export async function login(_: never, username: string, password: string) {
  const json = {
    email: username,
    password,
  };

  try {
    const responseData = await apiClient.post(`${baseApiUrl}/auth/login`, {
      json,
    });
    const authResponse = responseData.body as unknown as AuthResponse;
    authourization = authResponse.token;
    return authourization;
  } catch (error: any) {
    log(error);
    return null;
  }
}

export async function logout() {
  try {
    const responseData = await apiClient.delete(`${baseApiUrl}/auth/sessions`);
    const authResponse = responseData.body as unknown as LogoutResponse;
    if (authResponse.success) {
      authourization = "";
      return true;
    }
  } catch (error: any) {
    log(error);
    return null;
  }
}

export async function download(
  _: never,
  token: string,
  link: string,
  output: string
) {
  return fetchExam(token, link, output);
}

async function fetchExam(token: string, link: string, output: string) {
  const spinner = ora("Getting exam details...").start();

  const regex = /exams\/([a-z0-9]+)/;
  const match = link.match(regex);

  if (match) {
    const examId = match[1];
    console.log(examId);
    try {
      const responseData = await apiClient.get(
        `${baseApiUrl}/exam/by-assessmentId/${examId}`
      );

      const examMaster = responseData.body as unknown as MasterExam;
      spinner.info("Processing exam: " + examMaster.assessment.title.text);
      const examDetails = examMaster.data;

      const { choices } = await prompts({
        type: "multiselect",
        name: "choices",
        message: "Select exam to download",
        choices: examDetails.map((v, i) => ({
          title: `${i + 1}. ${v.title.text}`,
          value: v,
        })),
        hint: "- Space to select. Enter to start download.",
      });

      if (!choices || choices.length === 0) {
        spinner.info("No exam selected. Exiting.");
        return;
      }
      await pMap(
        choices as ExamInformation[],
        async (examInfo: ExamInformation, idx: number) => {
          // Bọc toàn bộ logic trong một try...catch lớn
          try {
            let success = false;
            let attempts = 0;
            const maxAttempts = 2;
            let response = null;

            // Vòng lặp retry để fetch dữ liệu
            while (!success && attempts < maxAttempts) {
              attempts++;
              try {
                response = await apiClient.get(
                  `${baseApiUrl}/exam-result/by-subject/${
                    examMaster.assessment._id
                  }?subject=${encodeURIComponent(examInfo.subject)}`
                );
                success = true;
                spinner.succeed(`Fetched exam: ${examInfo.title.text}`);
              } catch (error) {
                spinner.warn(
                  `Attempt ${attempts}: Exam '${examInfo.title.text}' not completed, submitting...`
                );
                if (attempts < maxAttempts) {
                  const maxTimeInMs = examInfo.time * 60 * 1000;
                  const randomDeductionInMs = Math.floor(Math.random() * 30000);
                  const completedTime = maxTimeInMs - randomDeductionInMs;

                  await apiClient.post(
                    `${baseApiUrl}/exam-result/submit-test/${examInfo._id}`,
                    {
                      json: {
                        assessmentId: examMaster.assessment._id,
                        examId: examInfo._id,
                        access: examInfo.access,
                        examCompledTime: completedTime,
                      },
                    }
                  );
                  spinner.info(
                    `Submitted '${examInfo.title.text}', retrying fetch...`
                  );
                }
              }
            }
            if (!response) {
              spinner.fail(
                `Failed to fetch '${examInfo.title.text}' after all attempts.`
              );
              return;
            }

            const examApiResponse = response.body as unknown as ExamApiResponse;
            const examQnA = examApiResponse.data.examData;
            const outputDir = path.dirname(output);

            const pdfFileName = `${examInfo.title.text}.pdf`;
            const pdfOutputPath = path.join(outputDir, pdfFileName);
            const examHtml = convertExamDataToHtml(examQnA);
            await generatePdf(examHtml, pdfOutputPath, pandocMetadata);

            const answerKeyFileName = `${examInfo.title.text}_ĐÁP_ÁN.pdf`;
            const answerKeyOutputPath = path.join(outputDir, answerKeyFileName);
            const answerKeyHtml = convertAnswersToHtml(examQnA);
            await generatePdf(
              answerKeyHtml,
              answerKeyOutputPath,
              pandocMetadata
            );
          } catch (error) {
            spinner.fail(
              `An unexpected error occurred with exam: ${examInfo.title.text}`
            );
            log(error);
          }
        }
      );
      return;
    } catch (error) {
      spinner.fail("An error occurred during the process.");
      console.error(error);
    }
  }
}

async function decryptData(encryptedString: string) {
  try {
    const decryptedBytes = CryptoJS.AES.decrypt(encryptedString, SECRET_KEY);
    const decryptedJsonString = decryptedBytes.toString(CryptoJS.enc.Utf8);

    if (!decryptedJsonString) {
      throw new Error("Encrypt Failed");
    }

    return JSON.parse(decryptedJsonString);
  } catch (error) {
    console.error("Encrypt Error: ", error);
    throw new Error("Encrypt Error:");
  }
}
