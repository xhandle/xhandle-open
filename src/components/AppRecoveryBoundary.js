import React from 'react';

export default class AppRecoveryBoundary extends React.Component {
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error,info){console.error('[app-render-failure]',error,info.componentStack);}
 render(){
  if(!this.state.failed)return this.props.children;
  return <main role="alert" className="m-8 rounded border border-amber-300 bg-amber-50 p-6">
   <h1 className="text-xl font-semibold">xHandle could not display this workspace</h1>
   <p className="my-3">A rendering error interrupted the view. This screen has not deleted your saved data. Unsaved work may still be in memory; avoid reloading until you have tried reopening the view.</p>
   <button className="rounded bg-blue-600 px-4 py-2 text-white" onClick={()=>this.setState({failed:false})}>Try reopening the view</button>
   <p className="mt-3">If the error returns, keep browser storage intact and share the console error for recovery.</p>
  </main>;
 }
}
