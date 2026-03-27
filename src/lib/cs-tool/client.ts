import { getEnv } from "@/lib/config/env";
import { logger } from "@/lib/logger";
import type {
  CsToolResponse,
  Order,
  CreateOrderParams,
  CreateOrderResponse,
  UpdateOrderParams,
  InventoryItem,
  InventoryDetailResponse,
  StockChangeParams,
  OperationBoard,
  CsContact,
  CreateContactParams,
  UpdateContactParams,
  ContactType,
  CreateContactTypeParams,
  OrderContact,
  Profile,
  ProfileMatchResponse,
  UpdateProfileParams,
  Stage,
  UpdateStageParams,
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

  async deleteOrder(id: string): Promise<CsToolResponse<void>> {
    return this.request<void>("DELETE", `/orders/${id}`);
  }

  // 재고
  async getInventory(filters?: {
    category?: string;
    low_stock?: string;
  }): Promise<CsToolResponse<InventoryItem[]>> {
    return this.request<InventoryItem[]>("GET", "/inventory", undefined, filters);
  }

  async getInventoryBySku(sku: string): Promise<CsToolResponse<InventoryDetailResponse>> {
    return this.request<InventoryDetailResponse>("GET", `/inventory/${sku}`);
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

  async updateOperationStatus(orderId: string, params: UpdateStageParams): Promise<CsToolResponse<void>> {
    return this.request<void>("PATCH", `/operations/${orderId}/status`, params);
  }

  // 연락처
  async getContacts(filters?: {
    type?: string;
    search?: string;
    page?: string;
    limit?: string;
  }): Promise<CsToolResponse<CsContact[]>> {
    return this.request<CsContact[]>("GET", "/contacts", undefined, filters);
  }

  async getContact(id: string): Promise<CsToolResponse<CsContact>> {
    return this.request<CsContact>("GET", `/contacts/${id}`);
  }

  async createContact(params: CreateContactParams): Promise<CsToolResponse<CsContact>> {
    return this.request<CsContact>("POST", "/contacts", params);
  }

  async updateContact(id: string, params: UpdateContactParams): Promise<CsToolResponse<CsContact>> {
    return this.request<CsContact>("PATCH", `/contacts/${id}`, params);
  }

  async deleteContact(id: string): Promise<CsToolResponse<void>> {
    return this.request<void>("DELETE", `/contacts/${id}`);
  }

  // 연락처 타입
  async getContactTypes(): Promise<CsToolResponse<ContactType[]>> {
    return this.request<ContactType[]>("GET", "/contact-types");
  }

  async createContactType(params: CreateContactTypeParams): Promise<CsToolResponse<ContactType>> {
    return this.request<ContactType>("POST", "/contact-types", params);
  }

  async deleteContactType(id: string): Promise<CsToolResponse<void>> {
    return this.request<void>("DELETE", `/contact-types/${id}`);
  }

  // 주문 연락처
  async getOrderContacts(orderId: string): Promise<CsToolResponse<OrderContact[]>> {
    return this.request<OrderContact[]>("GET", `/orders/${orderId}/contacts`);
  }

  async assignOrderContact(orderId: string, contactId: string): Promise<CsToolResponse<void>> {
    return this.request<void>("POST", `/orders/${orderId}/contacts`, { contactId });
  }

  async removeOrderContact(orderId: string, contactTypeId: string): Promise<CsToolResponse<void>> {
    return this.request<void>("DELETE", `/orders/${orderId}/contacts/${contactTypeId}`);
  }

  // 프로필
  async getProfiles(): Promise<CsToolResponse<Profile[]>> {
    return this.request<Profile[]>("GET", "/profiles");
  }

  async getProfile(id: string): Promise<CsToolResponse<Profile>> {
    return this.request<Profile>("GET", `/profiles/${id}`);
  }

  async updateProfile(id: string, params: UpdateProfileParams): Promise<CsToolResponse<Profile>> {
    return this.request<Profile>("PATCH", `/profiles/${id}`, params);
  }

  // 프로필 매칭
  async getProfilesBySkus(skus: string[]): Promise<CsToolResponse<ProfileMatchResponse>> {
    return this.request<ProfileMatchResponse>(
      "GET",
      "/profiles/match",
      undefined,
      { skus: skus.join(",") }
    );
  }

  // 단계
  async getStages(): Promise<CsToolResponse<Stage[]>> {
    return this.request<Stage[]>("GET", "/stages");
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
