import { getCsToolClient } from "@/lib/cs-tool/client";
import {
  buildKanbanMessage,
  buildStageDetailMessage,
} from "@/lib/slack/messages/operation";
import { logger } from "@/lib/logger";

export async function handleOperationCommand(text: string) {
  try {
    const client = getCsToolClient();
    const trimmed = text.trim();

    if (trimmed) {
      // 단계명으로 검색
      const stages = await client.getStages();
      const stage = (stages.data ?? []).find(
        (s) => s.name === trimmed || s.name.includes(trimmed)
      );

      if (stage) {
        const result = await client.getOperations({ stageId: stage.id });
        const board = result.data;
        if (!board) {
          return { response_type: "ephemeral", text: "오퍼레이션 조회에 실패했어요." };
        }
        const stageData = board.stages.find((s) => s.id === stage.id);
        if (stageData) return buildStageDetailMessage(stageData);
      }

      return {
        response_type: "ephemeral",
        text: `"${trimmed}" 단계를 찾을 수 없어요.`,
      };
    }

    // 전체 칸반 뷰
    const result = await client.getOperations();
    const board = result.data;

    if (!board) {
      return { response_type: "ephemeral", text: "오퍼레이션 조회에 실패했어요." };
    }

    return buildKanbanMessage(board);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ error: msg }, "오퍼레이션 조회 실패");
    return { response_type: "ephemeral", text: `오퍼레이션 조회에 실패했어요.\n에러: ${msg}` };
  }
}
