import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import type {
  CsToolResponse,
  Order,
  CreateOrderParams,
  CreateOrderResponse,
  UpdateOrderParams,
  InventoryItem,
  StockChangeParams,
  OperationBoard,
} from "./types";

class CsToolClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    params?: Record<string, string>
  ): Promise<CsToolResponse<T>> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value) url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      const errorMsg = data.error?.message ?? `HTTP ${response.status}`;
      logger.error({ path, status: response.status, error: data.error }, "CS Tool API 에러");
      throw new Error(errorMsg);
    }

    return data;
  }

  // 주문
  async getOrders(filters?: {
    status?: string;
    from?: string;
    to?: string;
    customer?: string;
    page?: string;
    limit?: string;
  }): Promise<CsToolResponse<Order[]>> {
    return this.request<Order[]>("GET", "/orders", undefined, filters);
  }

  async getOrder(id: string): Promise<CsToolResponse<Order>> {
    return this.request<Order>("GET", `/orders/${id}`);
  }

  async createOrder(params: CreateOrderParams): Promise<CsToolResponse<CreateOrderResponse>> {
    return this.request<CreateOrderResponse>("POST", "/orders", params);
  }

  async updateOrder(id: string, params: UpdateOrderParams): Promise<CsToolResponse<Order>> {
    return this.request<Order>("PATCH", `/orders/${id}`, params);
  }

  // 재고
  async getInventory(filters?: {
    category?: string;
    low_stock?: string;
  }): Promise<CsToolResponse<InventoryItem[]>> {
    return this.request<InventoryItem[]>("GET", "/inventory", undefined, filters);
  }

  async getInventoryBySku(sku: string): Promise<CsToolResponse<InventoryItem>> {
    return this.request<InventoryItem>("GET", `/inventory/${sku}`);
  }

  async inbound(params: StockChangeParams): Promise<CsToolResponse<InventoryItem>> {
    return this.request<InventoryItem>("POST", "/inventory/inbound", params);
  }

  async outbound(params: StockChangeParams): Promise<CsToolResponse<InventoryItem>> {
    return this.request<InventoryItem>("POST", "/inventory/outbound", params);
  }

  // 오퍼레이션
  async getOperations(filters?: {
    stageId?: string;
    status?: string;
  }): Promise<CsToolResponse<OperationBoard>> {
    return this.request<OperationBoard>("GET", "/operations", undefined, filters);
  }

  async changeStage(orderId: string, stageId: string): Promise<CsToolResponse<Order>> {
    return this.request<Order>("PATCH", `/operations/${orderId}/status`, { stageId });
  }
}

let _client: CsToolClient | null = null;

export function getCsToolClient(): CsToolClient {
  if (!_client) {
    const env = getEnv();
    _client = new CsToolClient(env.CS_TOOL_API_URL, env.CS_TOOL_API_KEY);
  }
  return _client;
}
