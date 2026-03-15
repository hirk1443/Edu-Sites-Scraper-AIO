import got, { Got, Response } from "got";
import CryptoJS from "crypto-js";
import ora from "ora";
import fs from "fs/promises";
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
const SECRET_KEY = "69affa98f9ab8efffd759dbd";

let authorization = "";

const apiClient: Got = got.extend({
  responseType: "json",
  hooks: {
    beforeRequest: [
      (options) => {
        if (authorization) {
          options.headers["Authorization"] = `Bearer ${authorization}`;
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
    password: password,
  };

  try {
    const responseData = await apiClient.post(`${baseApiUrl}/auth/login`, {
      json,
    });
    const authResponse = responseData.body as unknown as AuthResponse;
    authorization = authResponse.token;
    return authorization;
  } catch (error: any) {
    if (error.response) {
      console.error(error.response.body);
    }
    log(error.message);
    return null;
  }
}

export async function loginUsingToken(_: never, token: string) {
  try {
    authorization = token;
    console.log(`Logged in with token ${authorization}`);
    return authorization;
  } catch (error: any) {
    if (error.response) {
      console.error(error.response.body);
    }
    log(error.message);
    return null;
  }
}

export async function logout() {
  try {
    const responseData = await apiClient.delete(`${baseApiUrl}/auth/sessions`);
    const authResponse = responseData.body as unknown as LogoutResponse;
    if (authResponse.success) {
      authorization = "";
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
  output: string,
) {
  return fetchExam(token, link, output);
}

async function fetchExam(token: string, link: string, output: string) {
  const spinner = ora("Getting exam details...").start();

  try {
    const data = await fs.readFile("src\\downloader\\helper\\encrypted.txt", "utf8");
    const examMaster = (await decryptData(data)) as unknown as ExamApiResponse;
    spinner.info("Processing exam...");

    const examApiResponse = examMaster;
    const examQnA = examApiResponse.data.examData;
    const outputDir = path.dirname(output);

    const pdfFileName = `ĐỀ THI.pdf`;
    const pdfOutputPath = path.join(outputDir, pdfFileName);
    const examHtml = convertExamDataToHtml(examQnA);
    await generatePdf(examHtml, pdfOutputPath, pandocMetadata);

    const answerKeyFileName = `ĐÁP_ÁN.pdf`;
    const answerKeyOutputPath = path.join(outputDir, answerKeyFileName);
    const answerKeyHtml = convertAnswersToHtml(examQnA);
    await generatePdf(answerKeyHtml, answerKeyOutputPath, pandocMetadata);

    return;
  } catch (error) {
    spinner.fail("An error occurred during the process.");
    console.error(error);
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
