import React from "react";

export default function RoomStatus({ loaded, roomId, roomName, verified }: { loaded: boolean; roomId: string | null; roomName: string | null; verified: boolean }) {
  return <div className="chatwork-room-status" role="status">
    {!loaded ? <strong>ルームの設定状態を確認中</strong> : roomId ? <>
      <strong>ルーム設定完了</strong>
      <span>設定済みのルーム：{roomName || `ID ${roomId}`}</span>
      <small>{verified ? "投稿確認済みです。" : "投稿確認は未完了です。下の「3. 投稿を確認」へ進んでください。"}</small>
    </> : <><strong>ルーム未設定</strong><small>ルームIDを入力し、「ルーム名を確認する」を押してください。</small></>}
  </div>;
}
