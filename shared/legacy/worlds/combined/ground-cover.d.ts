export function createSourceGroundCover(options:{THREE:any;groundAt:(x:number,z:number)=>number}):{
 root:any;
 getInfo():{included:boolean;sites:readonly {name:string;generator:string;count:number;sourceTriangles:number;triangles:number;castsShadow:boolean}[];triangles:number;drawCalls:number;source:{repository:string;commit:string;license:string;path:string}};
 update(delta:number,camera?:any):void;setReducedMotion(value:boolean):void;dispose():void;
};
