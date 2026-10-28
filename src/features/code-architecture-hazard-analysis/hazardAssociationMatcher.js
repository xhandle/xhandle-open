const normalizeAssociationText=value=>String(value || '').trim().toLowerCase().replace(/\s+/g,' ');
const splitTraceCell=value=>String(value || '').split(/[,;|\n]+/).map(item=>item.trim()).filter(Boolean);
export function createHazardAssociationMatcher(headers,target){
 if(!target)return ()=>false;
 const indexes=new Map(headers.map((header,index)=>[String(header).trim().toLowerCase(),index]));
 const getHazardCell=(cells,name)=>String(cells[indexes.get(name.toLowerCase())] ?? '').trim();
    const targetLabel = normalizeAssociationText(target.label);
    const targetRowRefs = new Set(
      [
        ...(target.codeEvidence?.rowRefs || []),
        ...(target.rowRefs || []),
        target.rowRef,
      ]
        .filter((ref) => ref !== undefined && ref !== null && ref !== '')
        .map((ref) => String(ref).trim())
    );
    const targetElementIds = new Set(Array.from(targetRowRefs).map((ref) => `cba-row-${ref}`));
    if (target.id) targetElementIds.add(String(target.id));

    const sourceSymbols = new Set(
      (target.codeEvidence?.sourceFunctions || [])
        .map((fn) => normalizeAssociationText(fn?.functionName))
        .filter(Boolean)
    );
    if (targetLabel) sourceSymbols.add(targetLabel);

    return cells => {
      const architectureRowRef = getHazardCell(cells, 'Architecture Row Ref');
      const architectureElementId = getHazardCell(cells, 'Architecture Element ID');
      const functionFrom = normalizeAssociationText(getHazardCell(cells, 'Function (From)'));
      const controlAction = normalizeAssociationText(getHazardCell(cells, 'Control Action'));
      const functionTo = normalizeAssociationText(getHazardCell(cells, 'Function (To)'));
      const rowSymbols = splitTraceCell(getHazardCell(cells, 'Source Symbols')).map(normalizeAssociationText);

      const architectureRowRefs = splitTraceCell(architectureRowRef).map((ref) => String(ref || '').trim());
      if (architectureRowRefs.some((ref) => targetRowRefs.has(ref))) {
        return true;
      }
      const architectureElementIds = splitTraceCell(architectureElementId).map((ref) => String(ref || '').trim());
      if (architectureElementIds.some((ref) => targetElementIds.has(ref))) {
        return true;
      }

      if (target.type === 'edge') {
        const edgeFrom = normalizeAssociationText(target.fromFunction);
        const edgeAction = normalizeAssociationText(target.controlAction || target.label);
        const edgeTo = normalizeAssociationText(target.toFunction);
        if (edgeFrom && edgeTo && functionFrom === edgeFrom && functionTo === edgeTo && (!edgeAction || controlAction === edgeAction)) {
          return true;
        }
      }

      if (target.type === 'node' && targetLabel) {
        if (functionFrom === targetLabel || functionTo === targetLabel || rowSymbols.some((symbol) => sourceSymbols.has(symbol))) {
          return true;
        }
      }

      if (target.type === 'architectureBox') {
        const arch = target.architecture || {};
        const deepestArchPair = [
          ['CSU', arch.csu],
          ['CSC', arch.csc],
          ['CSCI', arch.csci],
          ['Subsystem', arch.subsystem],
        ].find(([, value]) => normalizeAssociationText(value));
        if (deepestArchPair && normalizeAssociationText(getHazardCell(cells, deepestArchPair[0])) === normalizeAssociationText(deepestArchPair[1])) {
          return true;
        }
      }
      return false;
    };

}
