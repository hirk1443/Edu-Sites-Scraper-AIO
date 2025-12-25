export interface EncryptedPayload {
  encrypted: boolean;
  data: any;
}

export interface AuthResponse {
  token: string;
  username: string;
  avatar: string;
}

export interface LogoutResponse {
  message: string;
  success: boolean;
}

export interface MasterExam {
  data: ExamInformation[];
  assessment: {
    _id: string;
    title: ExamTitle;
  };
}

export interface ExamInformation {
  _id: string;
  title: {
    text: string;
    code: string;
  };
  subject: string;
  time: number;
  access: "PUBLIC" | "PRIVATE";
}
export interface DragDropItem {
  id: string;
  content: string;
}

export interface BaseQuestion {
  question: string; // ID của câu hỏi (VD: "Câu 1" hoặc UUID)
  contentQuestions: string; // Nội dung câu hỏi, thường là HTML
  explanation?: string; // Giải thích đáp án (tùy chọn)
  videoUrl?: string; // URL video liên quan (tùy chọn)
}

/**
 * Type: MQ - Multi Question (Đoạn văn đọc hiểu)
 * Dùng để hiển thị một đoạn văn bản chung cho một nhóm câu hỏi.
 */
export interface PassageQuestion extends BaseQuestion {
  type: "MQ";
  title: string;
  range: number[];
}

/**
 * Type: TN - Trắc Nghiệm (Multiple Choice)
 * Câu hỏi lựa chọn một đáp án đúng.
 */
export interface MultipleChoiceQuestion extends BaseQuestion {
  type: "TN";
  correctAnswer: string;
  contentAnswerA: string;
  contentAnswerB: string;
  contentAnswerC?: string;
  contentAnswerD?: string;
}

/**
 * Type: MA - Multiple Answer
 * Câu hỏi cho phép chọn nhiều đáp án đúng.
 */
export interface MultipleAnswerQuestion extends BaseQuestion {
  type: "MA";
  correctAnswer: string[]; // Đáp án là một mảng các chuỗi
  contentC1?: string;
  contentC2?: string;
  contentC3?: string;
  contentC4?: string;
}

/**
 * Type: TLN - Tự Luận Ngắn (Fill in the Blank - Single)
 * Câu hỏi điền vào một chỗ trống.
 */
export interface FillSingleBlankQuestion extends BaseQuestion {
  type: "TLN";
  correctAnswer: (string | number)[];
}

/**
 * Type: TLN_M - Tự Luận Ngắn (Fill in the Blank - Multiple)
 * Câu hỏi điền vào nhiều chỗ trống.
 */
export interface FillMultipleBlanksQuestion extends BaseQuestion {
  type: "TLN_M";
  correctAnswer: Record<string, (string | number)[]>;
}

/**
 * Type: DS - Đúng/Sai (True/False)
 * Câu hỏi chọn Đúng hoặc Sai cho nhiều mệnh đề.
 */
export interface TrueFalseQuestion extends BaseQuestion {
  type: "DS";
  correctAnswer: Record<string, "D" | "S">;
  contentYA?: string;
  contentYB?: string;
  contentYC?: string;
  contentYD?: string;
}

/**
 * Type: KT - Kéo Thả (Drag and Drop)
 * Câu hỏi kéo thả từ/cụm từ vào chỗ trống.
 */
export interface DragDropQuestion extends BaseQuestion {
  type: "KT";
  correctAnswer: Record<string, string>;
  items: DragDropItem[];
}

/**
 * Discriminated Union Type cho tất cả các loại câu hỏi.
 */
// CẬP NHẬT: Thêm MultipleAnswerQuestion vào union type
export type Question =
  | PassageQuestion
  | MultipleChoiceQuestion
  | MultipleAnswerQuestion // <-- Đã thêm vào đây
  | FillSingleBlankQuestion
  | FillMultipleBlanksQuestion
  | TrueFalseQuestion
  | DragDropQuestion;

/**
 * Kiểu dữ liệu cho tiêu đề bài thi
 */
export interface ExamTitle {
  text: string;
  code: string;
}

/**
 * Kiểu dữ liệu hợp nhất cho các loại đáp án có thể có trong object `answer`
 */

export type AnswerValue =
  | string // Cho câu TN
  | string[] // Cho câu MA
  | Record<string, (string | number)[]> // Cho câu TLN_M
  | Record<string, "D" | "S"> // Cho câu DS
  | Record<string, string> // Cho câu KT
  | (string | number)[]; // Cho câu TLN

/**
 * Cấu trúc cho toàn bộ dữ liệu của một bài thi
 */
export interface ExamData {
  _id: string;
  title: ExamTitle;
  numberOfQuestions: number;
  time: number;
  active: boolean;
  answer: Record<string, AnswerValue>;
  startTime: string;
  endTime: string;
  questions: Question[];
  subject: string;
  imgUrl?: string;
  access: "PRIVATE" | "PUBLIC";
  typeExam: string;
  numberOfLikes: number;
  numberOfTest: number;
  type: string;
  createdAt: string;
  updatedAt: string;
  __v: number;
}

/**
 * Cấu trúc gốc của file JSON trả về từ API
 */
export interface ExamApiResponse {
  data: { examData: ExamData };
}
