import { AiDataCenterTable } from '@/components/aidatacenter/AiDataCenterTable';

export default function AiDataCenterPage() {
  return (
    <div>
      <h2 className="rv-h1">AI Data Center Stocks</h2>
      <div className="rv-sub">
        AI/HPC hosting peer comparison · WULF · CRWV · CIFR · NBIS · IREN · HUT — GPUs, $/MW, utilization, depreciation
      </div>
      <AiDataCenterTable />
    </div>
  );
}
