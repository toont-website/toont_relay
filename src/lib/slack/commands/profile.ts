import { getCsToolClient } from "@/lib/cs-tool/client";
import { getSlackClient } from "@/lib/slack/client";
import { logger } from "@/lib/logger";

export async function handleProfileCommand(text: string) {
  const trimmed = text.trim();

  if (trimmed.startsWith("수정")) {
    return searchForProfileEdit(trimmed.replace("수정", "").trim());
  }

  return listProfiles(trimmed || undefined);
}

async function listProfiles(search?: string) {
  const client = getCsToolClient();
  const result = await client.getProfiles();
  const profiles = result.data ?? [];

  const filtered = search
    ? profiles.filter((p) => p.name.includes(search))
    : profiles;

  if (filtered.length === 0) {
    return {
      response_type: "ephemeral",
      text: search
        ? `"${search}" 프로필을 찾을 수 없어요.`
        : "등록된 프로필이 없어요.",
    };
  }

  const blocks: any[] = [
    { type: "header", text: { type: "plain_text", text: "📂 프로필 목록" } },
  ];

  for (const p of filtered) {
    const badge = p.isDefault ? " ⭐ 기본" : "";
    const productDisplay = p.skuNames && p.skuNames.length > 0
      ? p.skuNames.join(", ")
      : p.skus.length > 0 ? p.skus.join(", ") : "-";
    const contactTypes = p.contactTypeNames && p.contactTypeNames.length > 0
      ? p.contactTypeNames.join(", ")
      : "";

    const lines = [`📌 *${p.name}*${badge}`];
    if (p.description) lines.push(`   설명: ${p.description}`);
    lines.push(`   상품: ${productDisplay}`);
    if (contactTypes) lines.push(`   필수 연락처: ${contactTypes}`);

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: lines.join("\n"),
      },
      accessory: {
        type: "button",
        text: { type: "plain_text", text: "수정" },
        action_id: "edit_profile",
        value: p.id,
      },
    });
  }

  return { response_type: "ephemeral", text: " ", blocks };
}

async function searchForProfileEdit(input: string) {
  if (!input) {
    return {
      response_type: "ephemeral",
      text: "수정할 프로필 이름을 입력해주세요.\n사용법: `/profile 수정 액자류`",
    };
  }
  return listProfiles(input);
}

export async function openProfileEditModal(
  triggerId: string,
  profileId: string
) {
  const client = getCsToolClient();
  const slackClient = getSlackClient();

  const profileResult = await client.getProfile(profileId);
  const profile = profileResult.data;
  if (!profile) return;

  await slackClient.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "profile_edit_modal",
      private_metadata: JSON.stringify({ profileId }),
      title: { type: "plain_text", text: "프로필 수정" },
      submit: { type: "plain_text", text: "저장" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "input",
          block_id: "name_block",
          label: { type: "plain_text", text: "이름" },
          element: {
            type: "plain_text_input",
            action_id: "name_input",
            initial_value: profile.name,
          },
        },
        {
          type: "input",
          block_id: "desc_block",
          label: { type: "plain_text", text: "설명" },
          optional: true,
          element: {
            type: "plain_text_input",
            action_id: "desc_input",
            ...(profile.description
              ? { initial_value: profile.description }
              : {}),
          },
        },
      ],
    },
  });
}

export async function handleProfileEditSubmit(payload: any) {
  let metadata: any;
  try {
    metadata = JSON.parse(payload.view.private_metadata);
  } catch {
    logger.error("private_metadata 파싱 실패 (handleProfileEditSubmit)");
    return null;
  }
  const { profileId } = metadata;
  const values = payload.view.state.values;

  const name = values.name_block.name_input.value;
  const description = values.desc_block?.desc_input?.value;

  const client = getCsToolClient();
  try {
    await client.updateProfile(profileId, {
      name,
      description,
    });
    logger.info({ profileId, name }, "프로필 수정 완료");
    return {
      response_action: "update",
      view: {
        type: "modal",
        title: { type: "plain_text", text: "완료" },
        close: { type: "plain_text", text: "닫기" },
        blocks: [
          {
            type: "section",
            text: { type: "mrkdwn", text: "프로필을 수정했어요." },
          },
        ],
      },
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : "알 수 없는 에러";
    logger.error({ profileId, error: msg }, "프로필 수정 실패");
    return {
      response_action: "errors" as const,
      errors: { name_block: `저장 실패: ${msg}` },
    };
  }
}
