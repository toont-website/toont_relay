import { getSlackClient } from "../client";

export async function handleSmsCommand(triggerId: string) {
  const client = getSlackClient();

  await client.views.open({
    trigger_id: triggerId,
    view: {
      type: "modal",
      callback_id: "sms_send_modal",
      title: { type: "plain_text", text: "문자 보내기" },
      submit: { type: "plain_text", text: "전송" },
      close: { type: "plain_text", text: "취소" },
      blocks: [
        {
          type: "input",
          block_id: "recipient_block",
          label: { type: "plain_text", text: "받는 사람" },
          element: {
            type: "external_select",
            action_id: "contact_select",
            placeholder: { type: "plain_text", text: "이름 또는 번호 검색..." },
            min_query_length: 1,
          },
        },
        {
          type: "input",
          block_id: "message_block",
          label: { type: "plain_text", text: "내용" },
          element: {
            type: "plain_text_input",
            action_id: "message_input",
            multiline: true,
            placeholder: { type: "plain_text", text: "문자 내용을 입력하세요" },
          },
        },
      ],
    },
  });
}
