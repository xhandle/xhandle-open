import React from "react";
import { createRoot } from "react-dom/client";
import ResultsReviewDrawer from "./ResultsReviewDrawer";

const { act } = React;
global.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("lucide-react", () => {
  const Icon = () => <span />;
  return new Proxy({}, { get: () => Icon });
});

describe("ResultsReviewDrawer dock-aware layout", () => {
  it("keeps the complete drawer inside the workspace left of Collaborator", () => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const props = {
      isOpen: true,
      options: {},
      items: [],
      onClose: jest.fn(),
      onToggleExpanded: jest.fn(),
      onApproveAsIs: jest.fn(),
      onApproveWithModifications: jest.fn(),
      onReject: jest.fn(),
      onNeedsRegeneration: jest.fn(),
      onRequestRegeneration: jest.fn(),
      onNeedsMoreContext: jest.fn(),
    };

    try {
      act(() => root.render(<ResultsReviewDrawer {...props} />));
      const viewport = host.firstElementChild;
      const drawer = viewport.firstElementChild;

      expect(viewport.className).toContain("left-0");
      expect(viewport.className).toContain("justify-end");
      expect(viewport.className).toContain("right-[var(--xhandle-collaborator-reserved-width)]");
      expect(drawer.className).toContain("w-[var(--results-review-drawer-width)]");
      expect(drawer.className).toContain("max-w-full");

      act(() => root.render(<ResultsReviewDrawer {...props} isExpanded />));
      expect(host.firstElementChild.firstElementChild.className)
        .toContain("w-[var(--results-review-drawer-expanded-width)]");
      expect(host.firstElementChild.firstElementChild.className).toContain("max-w-full");
    } finally {
      act(() => root.unmount());
      host.remove();
    }
  });
});


test("source save failure remains visible and allows retry without advancing", async () => {
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const content={rowIndex:0,columns:['ID','Hazard'],row:['HA-1','edited hazard']};
 const item={id:'review',artifactType:'code_architecture_hazard_summary_table',currentContent:content,originalContent:content};
 let rejectSave;
 const save=jest.fn().mockImplementationOnce(()=>new Promise((resolve,reject)=>{rejectSave=reject;})).mockResolvedValue(item);
 const props={isOpen:true,options:{},items:[item],onUpdateCurrentContent:save};
 const button=()=>Array.from(host.querySelectorAll('button')).find(el=>el.textContent==='Update table');
 try {
  await act(async()=>root.render(<ResultsReviewDrawer {...props}/>));
  await act(async()=>button().click());
  expect(host.querySelector('[role="status"]').textContent).toContain('Saving');
  expect(button()).toBeUndefined();
  await act(async()=>rejectSave(Error('Storage unavailable')));
  expect(host.querySelector('[role="alert"]').textContent).toContain('Storage unavailable');
  expect(button()).toBeDefined();
  await act(async()=>button().click());
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[1][1].row).toEqual(content.row);
  expect(host.querySelector('[role="alert"]')).toBeNull();
 }finally{act(()=>root.unmount());host.remove();}
});


test('pending review recovered after reload exposes retry without new edits',async()=>{
 const host=document.createElement('div');document.body.appendChild(host);const root=createRoot(host);
 const content={columns:['ID','Hazard'],row:['HA-1','original']};
 const item={id:'review',currentContent:content,originalContent:content,pendingSourceCommit:{id:'op',patch:{currentContent:{...content,row:['HA-1','pending edit']}}}};
 const retry=jest.fn().mockResolvedValue(item);
 try{
  await act(async()=>root.render(<ResultsReviewDrawer isOpen options={{}} items={[item]} onRetryPending={retry}/>));
  const buttons=Array.from(host.querySelectorAll('button'));
  expect(buttons.find(el=>el.textContent==='Update table')).toBeUndefined();
  await act(async()=>buttons.find(el=>el.textContent==='Retry review save').click());
  expect(retry).toHaveBeenCalledWith('review');
 }finally{act(()=>root.unmount());host.remove();}
});
