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
export interface OperationBoard {
  stages: Array<{
    id: string;
    name: string;
    orders: Order[];
  }>;
}

// 웹훅 이벤트
export interface CsToolWebhookEvent {
  event: "order.created" | "order.status_changed" | "inventory.updated" | "inventory.low_stock";
  data: any;
  timestamp: string;
}
