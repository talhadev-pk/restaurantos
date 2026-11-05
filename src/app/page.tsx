"use client";
import dynamic from "next/dynamic";
import { Loader2 } from "lucide-react";

const Spa = dynamic(() => import("@/spa/App"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen flex items-center justify-center text-muted text-sm gap-2">
      <Loader2 className="animate-spin" size={18} /> Starting RestaurantOS…
    </div>
  ),
});

export default function Page() {
  return <Spa />;
}
