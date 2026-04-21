"use client";

import dynamic from "next/dynamic";

const RiskMap = dynamic(() => import("./RiskMap"), { ssr: false });

export default function RiskMapClient() {
  return <RiskMap />;
}
