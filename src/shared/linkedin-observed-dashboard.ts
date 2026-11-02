/**
 * Pure, observational trend summaries from conflict-aware LinkedIn XLSX data.
 *
 * No calendar interpolation, post-age-normalized inference, source credibility
 * escalation or career-outcome attribution. A seven-day window is comparable
 * only when all seven calendar dates are available and uncontested.
 */
import type {
  LinkedInReconciliationReport, ReconciledDay, ReconciledValue,
} from "./linkedin-reconciliation.js";

export type LinkedInTrendMetric = "impressions" | "engagements" | "newFollowers";
export type WindowQuality = "complete" | "missing" | "conflict" | "insufficient-history";

export interface LinkedInWindowObservation {
  start: string;
  end: string;
  quality: WindowQuality;
  value: number | null;
  observedDays: number;
  missingDays: number;
  conflictingDays: number;
}
export interface LinkedInTrendComparison {
  metric: LinkedInTrendMetric;
  latest: LinkedInWindowObservation;
  previous: LinkedInWindowObservation;
  direction: "up" | "down" | "unchanged" | "unavailable";
  absoluteDifference: number | null;
  percentageDifference: number | null;
  note: string;
}
export interface LinkedInObservedDashboard {
  authority: "user-imported-linkedin-xlsx-observations";
  period: {start:string;end:string} | null;
  comparisons: LinkedInTrendComparison[];
  sources: number;
  statement: string;
}
const oneDay=86400000;
function dayNumber(day:string):number { return Date.parse(day+"T00:00:00.000Z")/oneDay; }
function dayAt(value:number):string{return new Date(value*oneDay).toISOString().slice(0,10);}
function windowFor(days:ReadonlyMap<string,ReconciledDay>,startIndex:number,
  metric:LinkedInTrendMetric):LinkedInWindowObservation {
  const first=dayAt(startIndex),last=dayAt(startIndex+6);
  let missingDays=0,conflictingDays=0,observedDays=0,total=0;
  for(let i=0;i<7;i++){
    const day=days.get(dayAt(startIndex+i));
    const value:ReconciledValue|undefined=day?.[metric];
    if(!value || value.state==="missing"){
      missingDays++;continue;
    }
    if(value.state==="conflict"){
      conflictingDays++;continue;
    }
    if(value.value===null || !Number.isSafeInteger(value.value)||value.value<0)
      throw new Error("Invalid reconciled LinkedIn metric.");
    total+=value.value;
    observedDays++;
  }
  const quality:WindowQuality=conflictingDays>0?"conflict":missingDays>0?"missing":"complete";
  return {start:first,end:last,quality,value:quality==="complete"&&Number.isSafeInteger(total)?total:null,
    observedDays,missingDays,conflictingDays};
}
function comparison(days:ReadonlyMap<string,ReconciledDay>,endDay:number,
  firstObservedDay:number,metric:LinkedInTrendMetric):LinkedInTrendComparison {
  const latest=windowFor(days,endDay-6,metric);
  const previous=windowFor(days,endDay-13,metric);
  if(endDay-firstObservedDay<13 && previous.quality!=="conflict" && previous.quality!=="missing")
    previous.quality="insufficient-history";
  if(latest.value===null||previous.value===null)return {
    metric,latest,previous,direction:"unavailable",absoluteDifference:null,percentageDifference:null,
    note:"A seven-day comparison is withheld when either window contains missing or disputed observations.",
  };
  const delta=latest.value-previous.value;
  if(!Number.isSafeInteger(delta))return {
    metric,latest,previous,direction:"unavailable",absoluteDifference:null,percentageDifference:null,
    note:"Difference exceeds exact integer range.",
  };
  return {
    metric,latest,previous,direction:delta>0?"up":delta<0?"down":"unchanged",
    absoluteDifference:delta,percentageDifference:previous.value===0?null:100*delta/previous.value,
    note:previous.value===0?
      "The previous seven-day sum is zero; a percentage change would be undefined.":
      "Calendar-aligned observational sums, not attributable to any particular post or career outcome.",
  };
}
export function buildLinkedInObservedDashboard(
  report:LinkedInReconciliationReport,
):LinkedInObservedDashboard {
  const metrics:LinkedInTrendMetric[]=["impressions","engagements","newFollowers"];
  const empty=(metric:LinkedInTrendMetric):LinkedInTrendComparison=>{
    const unavailable:LinkedInWindowObservation={
      start:"",end:"",quality:"insufficient-history",value:null,observedDays:0,missingDays:7,conflictingDays:0,
    };
    return {metric,latest:{...unavailable},previous:{...unavailable},
      direction:"unavailable",absoluteDifference:null,percentageDifference:null,
      note:"No imported daily analytics are available."};
  };
  if(!report.period || !report.daily.length)return {
    authority:"user-imported-linkedin-xlsx-observations",period:null,sources:report.imports,
    comparisons:metrics.map(empty),
    statement:"Nothing to compare until LinkedIn exports provide dated observations.",
  };
  const days=new Map(report.daily.map(item=>[item.date,item]));
  if(days.size!==report.daily.length)throw new Error("Duplicate reconciled daily dates.");
  const end=dayNumber(report.period.end);
  const first=dayNumber(report.period.start);
  if(!Number.isInteger(end)||!Number.isInteger(first)||end<first)
    throw new Error("Invalid LinkedIn analysis reporting period.");
  return {
    authority:"user-imported-linkedin-xlsx-observations",
    period:{...report.period},sources:report.imports,
    comparisons:metrics.map(metric=>comparison(days,end,first,metric)),
    statement:"Seven-day totals compare the latest reported calendar week with its preceding seven calendar days. Each date counts once. This reports observations, not causal effects or job-search outcomes.",
  };
}
