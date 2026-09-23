import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Info, Music2, TriangleAlert, X } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import { IconButton } from "../components";

export type NotificationKind = "info" | "success" | "playback" | "error";

export type NotificationNotice = {
  id: number;
  kind: NotificationKind;
  message: string;
};

let nextNotificationId = 0;

export function createNotification(
  message: string,
  kind: NotificationKind = "info",
): NotificationNotice {
  nextNotificationId += 1;
  return { id: nextNotificationId, kind, message };
}

const notificationHeadlines: Record<NotificationKind, string> = {
  info: "Update",
  success: "Saved",
  playback: "Now Playing",
  error: "Couldn’t complete",
};

type Props = {
  notice: NotificationNotice | null;
  setNotice: Dispatch<SetStateAction<NotificationNotice | null>>;
};

export function NotificationToast({ notice, setNotice }: Props) {
  if (!notice) return null;
  return (
    <NotificationToastCard
      key={notice.id}
      notice={notice}
      setNotice={setNotice}
    />
  );
}

function NotificationToastCard({
  notice,
  setNotice,
}: {
  notice: NotificationNotice;
  setNotice: Props["setNotice"];
}) {
  const [leaving, setLeaving] = useState(false);
  const isLeaving = useRef(false);
  const expireTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    if (!notice || isLeaving.current) return;
    isLeaving.current = true;
    setLeaving(true);
    removeTimer.current = setTimeout(() => {
      setNotice((current) => (current?.id === notice.id ? null : current));
    }, 220);
  }, [notice, setNotice]);

  useEffect(() => {
    expireTimer.current = setTimeout(dismiss, 4_700);
    return () => {
      if (expireTimer.current) clearTimeout(expireTimer.current);
      if (removeTimer.current) clearTimeout(removeTimer.current);
    };
  }, [dismiss]);

  const mark = {
    info: <Info size={21} strokeWidth={1.8} />,
    success: <Check size={21} strokeWidth={2.2} />,
    playback: <Music2 size={21} strokeWidth={1.9} />,
    error: <TriangleAlert size={20} strokeWidth={1.9} />,
  }[notice.kind];

  return (
    <div
      className="toast notification-toast"
      data-testid="notification-toast"
      data-kind={notice.kind}
      data-state={leaving ? "leaving" : "entering"}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <div className="notification-mark" aria-hidden="true">
        {mark}
      </div>
      <div className="notification-copy">
        <div className="notification-source">
          <span>VOLTA</span>
          <span aria-hidden="true">·</span>
          <time>now</time>
        </div>
        <div className="notification-headline">
          {notificationHeadlines[notice.kind]}
        </div>
        <p className="notification-message">{notice.message}</p>
      </div>
      <IconButton
        className="notification-dismiss"
        label="Dismiss notification"
        onClick={dismiss}
      >
        <X size={15} />
      </IconButton>
    </div>
  );
}
