import { Toaster as Sonner, toast } from "sonner";

const Toaster = ({ ...props }) => (
  <Sonner
    className="toaster group"
    richColors
    theme="light"
    toastOptions={{
      classNames: {
        toast: "group toast rounded-[20px] border border-[#E8E4DB] bg-[#FDFBF7] text-[#1A1918] shadow-[0_8px_32px_rgba(26,25,24,0.06)]",
        title: "font-medium",
        description: "text-[#4A4844]",
        actionButton: "bg-[#2A2928] text-[#FDFBF7]",
        cancelButton: "bg-[#F2EFE9] text-[#1A1918]",
      },
    }}
    {...props}
  />
);

export { Toaster, toast };
