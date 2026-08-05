import { CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type StatusTone = "success" | "warning" | "destructive" | "info";

const toneConfig: Record<
  StatusTone,
  { variant: "success" | "warning" | "destructive" | "secondary"; Icon: typeof CheckCircle2 }
> = {
  success: { variant: "success", Icon: CheckCircle2 },
  warning: { variant: "warning", Icon: AlertTriangle },
  destructive: { variant: "destructive", Icon: XCircle },
  info: { variant: "secondary", Icon: Info },
};

export function StatusBadge({
  tone,
  label,
  className,
}: {
  tone: StatusTone;
  label: string;
  className?: string;
}) {
  const { variant, Icon } = toneConfig[tone];
  return (
    <Badge variant={variant} className={cn("font-medium", className)}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {label}
    </Badge>
  );
}
