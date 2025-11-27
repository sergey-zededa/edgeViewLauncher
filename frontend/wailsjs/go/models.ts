export namespace config {
	
	export class Config {
	    baseUrl: string;
	    apiToken: string;
	    recentDevices: string[];
	
	    static createFrom(source: any = {}) {
	        return new Config(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.baseUrl = source["baseUrl"];
	        this.apiToken = source["apiToken"];
	        this.recentDevices = source["recentDevices"];
	    }
	}

}

export namespace main {
	
	export class SSHStatus {
	    status: string;
	    details?: string;
	    maxSessions?: number;
	    expiry?: string;
	    debugKnob: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SSHStatus(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.status = source["status"];
	        this.details = source["details"];
	        this.maxSessions = source["maxSessions"];
	        this.expiry = source["expiry"];
	        this.debugKnob = source["debugKnob"];
	    }
	}

}

export namespace zededa {
	
	export class Node {
	    id: string;
	    name: string;
	    projectId: string;
	    status: string;
	    edgeview: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Node(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.name = source["name"];
	        this.projectId = source["projectId"];
	        this.status = source["status"];
	        this.edgeview = source["edgeview"];
	    }
	}

}

