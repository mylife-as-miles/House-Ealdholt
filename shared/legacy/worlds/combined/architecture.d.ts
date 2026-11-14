import type { CombinedBuildingSpec } from './provenance';
export function createArchitectureKit(options:{THREE:any;profile?:'desktop'|'quest'}):{build(spec:CombinedBuildingSpec):any;stats():unknown;setSourceTransform?(inverse:any,forward:any,eye:any):void;dispose():void};
