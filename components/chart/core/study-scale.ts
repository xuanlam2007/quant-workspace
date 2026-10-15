export function independentStudyScale(id: string, requested: string, mainSide: string, sharesPricePane: boolean) {
  return sharesPricePane && requested === mainSide ? `study-scale:${id}` : requested;
}
