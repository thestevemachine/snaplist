import {afterEach,expect,it,vi} from "vitest";
import {workspaceStorageKey} from "@/lib/workspace-scope";
afterEach(()=>vi.unstubAllGlobals());
it("keeps existing owner drafts and separates other users' browser namespaces",()=>{
 vi.stubGlobal("document",{body:{dataset:{account:"member-a"}}});expect(workspaceStorageKey("drafts")).toBe("drafts:member-a");
 document.body.dataset.account="member-b";expect(workspaceStorageKey("drafts")).toBe("drafts:member-b");
 document.body.dataset.accountOwner="true";expect(workspaceStorageKey("drafts")).toBe("drafts");
});
