import type { Tool } from "../../src/shared/protocol";

// Script and output excerpts observed in the EC2 browser; no child-call metadata.
export const codemodeFixture: Tool = {
	id: "browser-codemode",
	name: "codemode",
	status: "success",
	args: {
		code: [
			'text(await tools.read({path:"emidat-api/tests/api/test_elementary_request_workflow.py",offset:1,limit:145}));',
			'text(await tools.read({path:"emidat-api/app/models/elementary.py",offset:75,limit:135}));',
			'text(await tools.bash({command:"cd emidat-api && rg -n \'get_elementary_mapping.cache_clear|_active_elementaries_by_holyapp_id|setattr\\\\(elementary, \\"get_all\\"|replace\\\\(.*active=False\' tests | head -40 && git log -1 --oneline && ls /tmp/dt507*exit","timeout":10}));',
			'text(await tools.read({path:"emidat-api/docs/elementary-request-delivery.md"}));',
		].join("\n"),
	},
	content: [
		{ type: "text", text: "Script completed\nWall time 0.2 seconds\nOutput:\n" },
		{
			type: "text",
			text: "import asyncio\nimport json\nfrom uuid import UUID, uuid4\n\nimport httpx\nimport pytest\n",
		},
		{
			type: "text",
			text: "                self.default,\n                self.customizable,\n                unit_hashable,\n                self.unit_label,\n            )\n        )\n\n\n@dataclass\nclass Elementary:\n",
		},
		{
			type: "text",
			text: JSON.stringify({
				output:
					'tests/core/elementary_test.py:49:    monkeypatch.setattr(elementary, "get_all", lambda: [inactive, active])\ntests/core/elementary_test.py:50:    elementary._active_elementaries_by_holyapp_id.cache_clear()\n',
				truncated: false,
				exit_code: 0,
				wall_time_seconds: 0.1,
			}),
		},
		{
			type: "text",
			text: "# Elementary request delivery\n\n## Rollout\n\nRequests retain their existing API Elementary IDs and customer response shape.\n",
		},
	],
};
