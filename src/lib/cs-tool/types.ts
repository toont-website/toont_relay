// API 응답 공통 포맷
export interface CsToolResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  meta?: { total: number; page: number; limit: number };
}

// 주문
/**
 * 주문에서 구매경로 추출 (channel > templateVariables.channel > orderId 순)
 */
export function getOrderChannel(order: Order): string | undefined {
  return order.channel
    ?? (order.templateVariables?.channel as string | undefined)
    ?? order.orderId
    ?? undefined;
}

export interface Order {
  id: string;
  orderId?: string;
  customerName: string;
  itemDescription: string | null;
  productNames: string | null;
  quantity: number;
  phone: string;
  sku: string | null;
  skus: string[];
  skuQuantities: Record<string, number>;
  address?: string;
  status: string;
  dueDate?: string;
  channel?: string;
  notes?: string;
  progress?: number;
  currentStageId?: string;
  currentStageName?: string;
  profileId: string | null;
  profileName: string | null;
  stageEnteredAt: string | null;
  stageDeadline: string | null;
  templateVariables: Record<string, unknown>;
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
  skus?: string[];
  skuQuantities?: Record<string, number>;
  address?: string;
  dueDate?: string;
  channel?: string;
  notes?: string;
  profileId?: string;
  customerContactId?: string;
  freightContactId?: string;
  shipDate?: string;
  progress?: string;
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
  templateVariables?: Record<string, unknown>;
}

// 재고
export interface InventoryItem {
  id: string;
  orgId: string;
  name: string;
  sku: string;
  quantity: number;
  minQuantity: number;
  unit: string;
  category?: string;
  price: number | null;
  notes: string | null;
  isLowStock: boolean;
}

export interface InventoryLog {
  id: string;
  inventoryItemId: string;
  changeType: "in" | "out" | "adjust";
  changeQuantity: number;
  reason: string | null;
  orderId: string | null;
  createdBy: string;
  createdAt: string;
}

export interface InventoryDetailResponse {
  item: InventoryItem;
  recentLogs: InventoryLog[];
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
  orgId: string;
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
  orgId: string;
  name: string;
  slug: string;
  isDefault: boolean;
  createdAt: string;
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
  orgId: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  contactTypeIds: string[];
  skus: string[];
  skuNames?: string[];
  contactTypeNames?: string[];
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

// 프로필 매칭
export interface ProfileMatchResponse {
  profiles: Profile[];
  skus: string[];
  matchCount: number;
}

// 웹훅 이벤트
export interface CsToolWebhookEvent {
  event:
    | "order.created"
    | "order.deleted"
    | "order.stage_changed"
    | "order.deadline_changed"
    | "order.status_changed"
    | "inventory.updated"
    | "inventory.low_stock";
  data: any;
  timestamp: string;
}
