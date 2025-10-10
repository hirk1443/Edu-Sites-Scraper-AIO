import ora from "ora";
import { ExamData, Question } from "../../types/bmc_type";
import { spawn } from "child_process";
import path from "path";

function normalizeMathContent(content: string): string {
  if (!content) return "";
  
  let result = content.replace(/\\\[(.*?)\\\]/g, '$$$$$1$$$$');
  result = result.replace(/\$\[(.*?)\]/g, '$$$$$1$$$$');

  result = result.replace(/\\\$/g, '$');
  
  result = result.replace(/\\2/g, '^{\\circ}C');

  return result;
}

export function convertExamDataToHtml(examData: ExamData): string {
  let html = `<h1>${examData.title.text}</h1>
              <p><strong>Môn học:</strong> ${examData.subject}</p>
              <p><strong>Thời gian làm bài:</strong> ${examData.time} phút</p>
              <p><strong>Tài liệu được render bởi TLKHMPKV</strong></p>
              `;

  for (const question of examData.questions) {
    let questionContent = normalizeMathContent(question.contentQuestions || "");
    const imageUrls: string[] = [];

    const imgRegex = /<img src="([^"]+)"[^>]*>/g;
    let match;
    while ((match = imgRegex.exec(questionContent)) !== null) {
      imageUrls.push(match[1]);
    }
    questionContent = questionContent.replace(imgRegex, "").trim();

    const blankRegex =
      /<span class="(?:drag-drop-blank|fill-blank)"[^>]*>.*?<\/span>/g;
    questionContent = questionContent.replace(blankRegex, "_____________");

    if (question.type === "MQ") {
      html += `<div>${questionContent}</div>`;

      if (imageUrls.length > 0) {
        imageUrls.forEach((url) => {
          html += `<img src="${url}" style="max-width: 50%; height: auto; display: block; margin: 10px auto;" /><br>`;
        });
      }
      html += `<hr />`;
    } else {
      html += `<div>`;
      html += `<p><strong>${question.question}.</strong></p>`;
      html += `<div>${questionContent}</div>`;

      if (imageUrls.length > 0) {
        imageUrls.forEach((url) => {
          html += `<img src="${url}" style="max-width: 50%; height: auto; display: block; margin: 10px auto;" />`;
        });
      }

      switch (question.type) {
        case "TN":
          html += `<ul>`;
          if (question.contentAnswerA)
            html += `<li>A. ${question.contentAnswerA}</li>`;
          if (question.contentAnswerB)
            html += `<li>B. ${question.contentAnswerB}</li>`;
          if (question.contentAnswerC)
            html += `<li>C. ${question.contentAnswerC}</li>`;
          if (question.contentAnswerD)
            html += `<li>D. ${question.contentAnswerD}</li>`;
          html += `</ul>`;
          break;
        case "MA":
          const choices = Object.keys(question)
            .filter((key) => key.startsWith("contentC"))
            .sort()
            .map((key) => (question as any)[key]);

          html += `<ul>`;
          choices.forEach((choice, index) => {
            const letter = String.fromCharCode(65 + index);
            html += `<li>[ ] ${letter}. ${choice}</li>`;
          });
          html += `</ul>`;
          break;
        case "DS":
          html += `<ul>`;
          if (question.contentYA) html += `<li>a) ${question.contentYA}</li>`;
          if (question.contentYB) html += `<li>b) ${question.contentYB}</li>`;
          if (question.contentYC) html += `<li>c) ${question.contentYC}</li>`;
          if (question.contentYD) html += `<li>d) ${question.contentYD}</li>`;
          html += `</ul>`;
          break;
        case "KT":
          html += `<p><strong>Các lựa chọn:</strong></p><ul>`;
          question.items.forEach((item) => {
            html += `<li>${item.content}</li>`;
          });
          html += `</ul>`;
          break;
      }
      html += `</div>`;
    }
  }
  return html;
}
export function convertAnswersToHtml(examData: ExamData): string {
  let html = `<h2>${examData.title.text}</h2>
             <p><strong>Tài liệu được render bởi TLKHMPKV</strong></p>
              <hr />`;

  for (const question of examData.questions) {
    if (question.type === "MQ") {
      continue;
    }

    html += `<div>`;
    html += `<p><strong>${question.question}.</strong></p>`;

    let answerString = "Không có đáp án";
    const correctAnswer = (question as any).correctAnswer;

    if (correctAnswer) {
      switch (question.type) {
        case "TN":
          answerString = correctAnswer;
          break;
        case "MA":
          answerString = correctAnswer
            .map((c: string) =>
              String.fromCharCode(65 + parseInt(c.substring(1)) - 1)
            )
            .join(", ");
          break;
        case "DS":
          answerString = Object.entries(correctAnswer)
            .map(([key, value]) => `${key}) ${value === "D" ? "Đúng" : "Sai"}`)
            .join(";&nbsp; ");
          break;
        case "KT":
          answerString = Object.entries(correctAnswer)
            .map(([slot, item]) => {
              const slotNum = slot.replace("slot", "");
              const itemContent = (item as string).replace(">", "");
              return `${slotNum} → ${itemContent}`;
            })
            .join(";&nbsp; ");
          break;
        case "TLN":
          answerString = correctAnswer.join(", ");
          break;
        case "TLN_M":
          answerString = Object.entries(correctAnswer)
            .map(
              ([key, value]) =>
                `${key} ${(value as (string | number)[]).join(", ")}`
            )
            .join(";&nbsp; ");
          break;
      }
    }

    html += `<p><strong>Đáp án: ${answerString}</strong></p>`;

    if (question.explanation) {
      const normalizedExplanation = normalizeMathContent(question.explanation);
      const cleanExplanation = normalizedExplanation
        .replace(/^<br\s*\/?>/i, "")
        .trim();
      html += `<div><em><strong>Giải thích:</strong> ${cleanExplanation}</em></div>`;
    }

    html += `<hr />`;
    html += `</div>`;
  }

  return html;
}

export function generatePdf(
  htmlContent: string,
  outputFilePath: string,
  metadataPath: string
) {
  const spinner = ora(
    `Generating PDF: ${path.basename(outputFilePath)}`
  ).start();

  const pandocArgs = [
    "-f",
    "html+raw_tex+tex_math_dollars",
    "-o",
    outputFilePath,
    "--metadata-file",
    metadataPath,
    "--pdf-engine=xelatex",
    "--mathjax",
  ];

  const pandocProcess = spawn("pandoc", pandocArgs);

  pandocProcess.stdin.write(htmlContent);
  pandocProcess.stdin.end();

  let errorOutput = "";
  pandocProcess.stderr.on("data", (data) => {
    errorOutput += data.toString();
  });

  return new Promise<void>((resolve, reject) => {
    pandocProcess.on("close", (code) => {
      if (code === 0) {
        spinner.succeed(
          `Successfully generated ${path.basename(outputFilePath)}`
        );
        resolve();
      } else {
        spinner.fail(`Pandoc failed with code ${code}`);
        console.error("Pandoc Error:", errorOutput);
        reject(
          new Error(`Pandoc failed to generate PDF. Error: ${errorOutput}`)
        );
      }
    });

    pandocProcess.on("error", (err) => {
      spinner.fail(`Failed to start Pandoc process.`);
      console.error(
        "Make sure Pandoc and a LaTeX distribution (with xelatex) are installed and in your system's PATH."
      );
      reject(err);
    });
  });
}
