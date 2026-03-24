// API 응답 공통 포맷
export interface CsToolResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  meta?: { total: number; page: number; limit: number };
}

// 주문
export interface Order {
  id: string;
  customerName: string;
  itemDescription: string;
  quantity: number;
  phone: string;
  address?: string;
  status: string;
  dueDate?: string;
  channel?: string;
  notes?: string;
  currentStageId?: string;
  currentStageName?: string;
  profileId: string | null;
  profileName: string | null;
  stageEnteredAt: string | null;
  stageDeadline: string | null;
  templateVariables: Record<string, string>;
  contacts: OrderContact[];
  requiredContactTypes: RequiredContactType[];
  currentStageTemplates: StageTemplate[];
  checklistStatus: ChecklistStatus[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateOrderParams {
  customerName: string;
  itemDescription: string;
  quantity: number;
  phone: string;
  sku?: string;
  address?: string;
  dueDate?: string;
  channel?: string;
  notes?: string;
}

export interface CreateOrderResponse {
  order: Order;
  inventory?: {
    deducted: boolean;
    remaining: number | null;
    warning: string | null;
  };
}

export interface UpdateOrderParams {
  status?: string;
  notes?: string;
  templateVariables?: Record<string, string>;
}

// 재고
export interface InventoryItem {
  id: string;
  name: string;
  sku: string;
  quantity: number;
  minQuantity?: number;
  unit: string;
  category?: string;
}

export interface StockChangeParams {
  sku: string;
  quantity: number;
  reason?: string;
  orderId?: string;
}

// 오퍼레이션
export interface OperationStage {
  id: string;
  name: string;
  position: number;
  color: string;
  orders: Order[];
}

export interface OperationBoard {
  stages: OperationStage[];
}

export interface UpdateStageParams {
  stageId: string;
  stageDeadline?: string;
  skipChecklist?: boolean;
}

// 연락처
export interface CsContact {
  id: string;
  typeId: string;
  typeName: string;
  typeSlug: string;
  name: string;
  phone: string;
  memo: string | null;
  address: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateContactParams {
  name: string;
  typeId?: string;
  phone?: string;
  memo?: string;
  address?: string;
}

export interface UpdateContactParams {
  name?: string;
  typeId?: string;
  phone?: string;
  memo?: string;
  address?: string;
}

export interface ContactType {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
}

export interface CreateContactTypeParams {
  name: string;
  slug: string;
}

// 주문 연락처
export interface OrderContact {
  type: string;
  typeName: string;
  name: string;
  phone: string;
}

export interface RequiredContactType {
  id: string;
  slug: string;
  name: string;
}

// 프로필
export interface Profile {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  contactTypeIds: string[];
  skus: string[];
  variableHints: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileParams {
  name?: string;
  description?: string;
  isDefault?: boolean;
  contactTypeIds?: string[];
  variableHints?: Record<string, string>;
}

// 단계
export interface Stage {
  id: string;
  name: string;
  position: number;
  color: string;
  defaultDays: number;
  requiredItems: StageRequiredItem[];
}

export interface StageRequiredItem {
  id: string;
  type: "checkbox" | "text";
  label: string;
}

// 체크리스트
export interface ChecklistItem {
  id: string;
  type: "checkbox" | "text";
  label: string;
  checked?: boolean;
  value?: string;
}

export interface ChecklistStatus {
  stageId: string;
  stageName: string;
  complete: boolean;
  items: ChecklistItem[];
}

// 단계 템플릿
export interface StageTemplate {
  contactType: string;
  contactTypeName: string;
  label: string;
  text: string;
}

// 웹훅 이벤트
export interface CsToolWebhookEvent {
  event: "order.created" | "order.status_changed" | "inventory.updated" | "inventory.low_stock";
  data: any;
  timestamp: string;
}
