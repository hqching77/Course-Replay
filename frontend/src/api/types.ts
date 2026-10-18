// API contracts mirrored from readme.md section 6/7.
// The frontend talks to these shapes only; mock or real backend both conform.

export type DocStatus = 'uploading' | 'parsing' | 'indexing' | 'done' | 'failed' | 'pending_ocr';
export type DocType = 'pdf' | 'pptx' | 'docx' | 'md' | 'txt' | 'png' | 'jpg';

export interface CourseDocument {
  id: string;
  courseId: string;
  filename: string;
  fileType: DocType;
  sizeKB: number;
  status: DocStatus;
  stageLabel: string;      // human readable current stage
  progress: number;        // 0-100
  totalPages: number;
  error?: string;
  createdAt: string;
}

export interface DocPage {
  page: number;            // page or slide number, 1-based
  kind: 'page' | 'slide' | 'section';
  text: string;
  chunkId: string;
}

export interface KnowledgeNode {
  id: string;
  courseId: string;
  title: string;
  definition: string;
  depth: number;
  learningOrder: number;   // position on the main line
  prereqIds: string[];
  chunkIds: string[];
  mastery: number;         // 0-1
  status: 'done' | 'current' | 'locked' | 'available';
}

export interface Citation {
  chunkId: string;
  documentId: string;
  filename: string;
  page: number;
  kind: 'page' | 'slide' | 'section';
}

export type QuestionType = 'choice' | 'short' | 'explain';

export interface Question {
  id: string;
  nodeId: string;
  type: QuestionType;
  prompt: string;
  choices?: string[];
  difficulty: 1 | 2 | 3;
  citations: Citation[];
}

export interface Evaluation {
  correct: boolean;
  guessed: boolean;        // 答对但疑似猜测
  score: number;           // 0-1
  feedback: string;
  answer: string;
  reason: string;
  masteryBefore: number;
  masteryAfter: number;
  citations: Citation[];
}

export interface ReplayMessage {
  id: string;
  role: 'teacher' | 'user' | 'feedback';
  text: string;            // markdown, may contain [^cN] citation markers
  citations: Citation[];
  kind?: 'explain' | 'question' | 'evaluation' | 'branch' | 'note';
  streaming?: boolean;
}

export interface MasteryInfo {
  nodeId: string;
  title: string;
  score: number;
  attempts: number;
  weakReason?: string;
}

export interface WrongRecord {
  questionId: string;
  nodeTitle: string;
  prompt: string;
  userAnswer: string;
  answer: string;
  at: string;
}

export interface BranchRecord {
  id: string;
  fromNodeTitle: string;
  question: string;
  depth: number;
  status: 'open' | 'done';
  at: string;
}

export interface ActivityRecord {
  at: string;
  text: string;
}

export interface StudyRecords {
  mastery: MasteryInfo[];
  wrong: WrongRecord[];
  branches: BranchRecord[];
  activities: ActivityRecord[];
}

export interface ReviewSheetRequest {
  scopeNodeIds: string[];
  types: QuestionType[];
  difficulty: 1 | 2 | 3;
  count: number;
}

export interface ReviewSheetItem {
  id: string;
  nodeTitle: string;
  type: QuestionType;
  prompt: string;
  choices?: string[];
  answer: string;
  explanation: string;
}

export interface StreamHandlers {
  onToken: (text: string) => void;
  onDone: () => void;
  onError: (message: string) => void;
}
