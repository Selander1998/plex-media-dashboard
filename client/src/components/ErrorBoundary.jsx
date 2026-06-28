import { Component } from "react";

export default class ErrorBoundary extends Component {
	state = { error: null };
	static getDerivedStateFromError(error) { return { error }; }
	render() {
		if (this.state.error)
			return (
				<div className="text-center py-12 text-red-400">
					<p className="font-semibold mb-2">Something went wrong</p>
					<p className="text-xs text-slate-500 mb-4">{this.state.error.message}</p>
					<button
						onClick={() => location.reload()}
						className="px-3 py-1.5 text-xs bg-surface border border-border rounded hover:border-slate-500 text-slate-300 cursor-pointer"
					>
						Reload
					</button>
				</div>
			);
		return this.props.children;
	}
}
