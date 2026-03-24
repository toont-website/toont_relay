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
    const skus = p.skus.length > 0 ? p.skus.join(", ") : "-";

    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `📌 *${p.name}*${badge}\n   SKU: ${skus}\n   ${p.description ?? ""}`,
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

  const [profileResult, typesResult] = await Promise.all([
    client.getProfile(profileId),
    client.getContactTypes(),
  ]);

  const profile = profileResult.data;
  const types = typesResult.data ?? [];
  if (!profile) return;

  const typeOptions = types.map((t) => ({
    text: { type: "plain_text" as const, text: t.name },
    value: t.id,
  }));

  const initialTypes = typeOptions.filter((o) =>
    profile.contactTypeIds.includes(o.value)
  );

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
        {
          type: "input",
          block_id: "default_block",
          label: { type: "plain_text", text: "기본 프로필" },
          optional: true,
          element: {
            type: "checkboxes",
            action_id: "default_check",
            options: [
              {
                text: {
                  type: "plain_text",
                  text: "기본 프로필로 설정",
                },
                value: "default",
              },
            ],
            ...(profile.isDefault
              ? {
                  initial_options: [
                    {
                      text: {
                        type: "plain_text",
                        text: "기본 프로필로 설정",
                      },
                      value: "default",
                    },
                  ],
                }
              : {}),
          },
        },
        ...(typeOptions.length > 0
          ? [
              {
                type: "input",
                block_id: "types_block",
                label: { type: "plain_text", text: "필수 연락처 타입" },
                optional: true,
                element: {
                  type: "multi_static_select",
                  action_id: "types_select",
                  options: typeOptions,
                  ...(initialTypes.length > 0
                    ? { initial_options: initialTypes }
                    : {}),
                },
              },
            ]
          : []),
      ],
    },
  });
}

export async function handleProfileEditSubmit(payload: any) {
  const { profileId } = JSON.parse(payload.view.private_metadata);
  const values = payload.view.state.values;

  const name = values.name_block.name_input.value;
  const description = values.desc_block?.desc_input?.value;
  const isDefault =
    (values.default_block?.default_check?.selected_options?.length ?? 0) > 0;
  const contactTypeIds = (
    values.types_block?.types_select?.selected_options ?? []
  ).map((o: any) => o.value);

  const client = getCsToolClient();
  await client.updateProfile(profileId, {
    name,
    description,
    isDefault,
    contactTypeIds,
  });

  logger.info({ profileId, name }, "프로필 수정 완료");
  return null;
}
