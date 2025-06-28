// empire_type.ts - FILE ĐÃ ĐƯỢC CẬP NHẬT

// --- THAY THẾ HOẶC THÊM CÁC INTERFACE NÀY ---

/**
 * Định nghĩa siêu dữ liệu cho các tài nguyên là tài liệu.
 */
export interface ResourceMetadata {
  size: number;
  mimeType: string;
  originalName: string;
}

/**
 * Type cơ sở cho một tài nguyên.
 * ĐÃ CẬP NHẬT: Thêm các trường mới từ JSON.
 */
export interface BaseResource {
  _id: string;
  title: string;
  fileUrl: string;
  description?: string; // Thêm mới
  knowledgeNodes: any[]; // Thêm mới
  tags: any[]; // Thêm mới
  createdBy: string; // Thêm mới
  updatedBy: string; // Thêm mới
  createdAt: string; // Thêm mới
  updatedAt: string; // Thêm mới
  __v?: number; // Thêm mới
}

/**
 * Định nghĩa một tài nguyên là tài liệu (document).
 */
export interface DocumentResource extends BaseResource {
  type: "document";
  metadata: ResourceMetadata;
}

/**
 * Định nghĩa một tài nguyên là video.
 */
export interface VideoResource extends BaseResource {
  type: "video";
  metadata?: Partial<ResourceMetadata>; // Metadata có thể có hoặc không
}

/**
 * Sử dụng Discriminated Union để định nghĩa một tài nguyên.
 */
export type Resource = DocumentResource | VideoResource;

/**
 * Định nghĩa đối tượng bao bọc (wrapper) cho một tài nguyên.
 */
export interface ResourceWrapper {
  resource: Resource;
  order: number;
  _id: string;
}

/**
 * Định nghĩa một bài học (lesson).
 * ĐÃ CẬP NHẬT: Thêm các trường mới từ JSON.
 */
export interface Lesson {
  _id: string;
  title: string;
  slug: string;
  description: string;
  duration: number;
  resources: ResourceWrapper[];
  knowledgeNodes: any[]; // Thêm mới
  exams: any[]; // Thêm mới
  createdBy: string; // Thêm mới
  updatedBy: string; // Thêm mới
  createdAt: string; // Thêm mới
  updatedAt: string; // Thêm mới
  __v?: number; // Thêm mới
}

// ---- CÁC TYPE HOÀN TOÀN MỚI CHO LESSON API RESPONSE ----

/**
 * Type cho đối tượng 'course' tóm tắt khi gọi API của một bài học
 */
export interface CourseSummary {
  _id: string;
  title: string;
  slug: string;
  thumbnail: string;
}

/**
 * Type cho đối tượng 'chapter' tóm tắt khi gọi API của một bài học
 */
export interface ChapterSummary {
  _id: string;
  title: string;
  order: number;
  lessonOrder: number;
}

/**
 * Type mới cho response từ API khi lấy một bài học (lesson)
 */
export interface LessonApiResponse {
  errorCode: number;
  lesson: Lesson;
  course: CourseSummary;
  chapter: ChapterSummary;
}

export interface VideoUrl {
  url: string;
  expiredIn: number;
}
