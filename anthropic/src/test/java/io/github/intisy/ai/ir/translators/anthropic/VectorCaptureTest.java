package io.github.intisy.ai.ir.translators.anthropic;

import io.github.intisy.ai.ir.Block;
import io.github.intisy.ai.ir.IrMessage;
import io.github.intisy.ai.ir.IrRequest;
import io.github.intisy.ai.ir.TextBlock;
import io.github.intisy.ai.ir.UnknownBlock;
import io.github.intisy.ai.ir.IrResponse;
import io.github.intisy.ai.ir.json.IrJson;
import io.github.intisy.ai.ir.json.TestJsonCodec;
import io.github.intisy.ai.ir.spi.JsonCodec;
import io.github.intisy.ai.ir.spi.StreamDecoder;
import io.github.intisy.ai.ir.spi.StreamEncoder;
import io.github.intisy.ai.ir.stream.IrStreamEvent;
import org.junit.jupiter.api.Test;

import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

class VectorCaptureTest {
    private final JsonCodec json = new TestJsonCodec();
    private final AnthropicTranslator translator = new AnthropicTranslator(json);
    private final Path out = Paths.get(System.getenv("VECTOR_OUT"));

    private static Object staticOf(String className, String name) throws Exception {
        Field field = Class.forName("io.github.intisy.ai.ir.translators.anthropic." + className).getDeclaredField(name);
        field.setAccessible(true);
        return field.get(null);
    }

    private void write(String name, String direction, Object input, Object output) throws Exception {
        Map<String, Object> vector = new LinkedHashMap<>();
        vector.put("direction", direction);
        vector.put("input", input);
        vector.put("output", output);
        Files.createDirectories(out);
        Files.write(out.resolve(name + ".json"), json.stringify(vector).getBytes(StandardCharsets.UTF_8));
    }


    private static final String PLACEHOLDER = "@@unknown:";

    private Map<String, UnknownBlock> hideUnknownBlocks(List<Block> blocks) {
        Map<String, UnknownBlock> hidden = new LinkedHashMap<>();
        for (int i = 0; i < blocks.size(); i++) {
            if (blocks.get(i) instanceof UnknownBlock) {
                String key = PLACEHOLDER + hidden.size();
                hidden.put(key, (UnknownBlock) blocks.get(i));
                blocks.set(i, new TextBlock(key));
            }
        }
        return hidden;
    }

    private Map<String, Object> unknownBlockMap(UnknownBlock block) {
        Map<String, Object> map = new LinkedHashMap<>();
        map.put("kind", "unknown");
        if (block.cacheControl != null) map.put("cacheControl", block.cacheControl);
        map.put("raw", block.raw);
        if (block.extensions != null) map.put("extensions", block.extensions);
        return map;
    }

    @SuppressWarnings("unchecked")
    private Object restoreUnknownBlocks(Object node, Map<String, UnknownBlock> hidden) {
        if (node instanceof List) {
            List<Object> list = (List<Object>) node;
            for (int i = 0; i < list.size(); i++) list.set(i, restoreUnknownBlocks(list.get(i), hidden));
            return list;
        }
        if (node instanceof Map) {
            Map<String, Object> map = (Map<String, Object>) node;
            Object text = map.get("text");
            if ("text".equals(map.get("kind")) && text instanceof String && hidden.containsKey(text)) {
                return unknownBlockMap(hidden.get(text));
            }
            for (Map.Entry<String, Object> entry : map.entrySet()) entry.setValue(restoreUnknownBlocks(entry.getValue(), hidden));
        }
        return node;
    }

    private Object requestIr(String wire) {
        IrRequest request = translator.decodeRequest(wire);
        Map<String, UnknownBlock> hidden = new LinkedHashMap<>();
        if (request.system != null) hidden.putAll(hideUnknownBlocks(request.system));
        for (IrMessage message : request.messages) hidden.putAll(hideUnknownBlocks(message.content));
        return restoreUnknownBlocks(json.parse(IrJson.serializeRequest(json, request)), hidden);
    }

    private Object responseIr(String wire) {
        IrResponse response = translator.decodeResponse(wire);
        Map<String, UnknownBlock> hidden = hideUnknownBlocks(response.content);
        return restoreUnknownBlocks(json.parse(IrJson.serializeResponse(json, response)), hidden);
    }

    private void requestCase(String name, String wire) throws Exception {
        IrRequest decoded = translator.decodeRequest(wire);
        Object ir = requestIr(wire);
        write(name + ".decode", "decodeRequest", json.parse(wire), ir);
        write(name + ".encode", "encodeRequest", ir, json.parse(translator.encodeRequest(decoded)));
    }

    private void responseCase(String name, String wire) throws Exception {
        IrResponse decoded = translator.decodeResponse(wire);
        Object ir = responseIr(wire);
        write(name + ".decode", "decodeResponse", json.parse(wire), ir);
        write(name + ".encode", "encodeResponse", ir, json.parse(translator.encodeResponse(decoded)));
    }

    private void streamCase(String name, String sse, int splitPoint) throws Exception {
        StreamDecoder decoder = translator.newStreamDecoder();
        List<IrStreamEvent> events = new ArrayList<>();
        events.addAll(decoder.decode(sse.substring(0, splitPoint)));
        events.addAll(decoder.decode(sse.substring(splitPoint)));
        List<Object> eventMaps = new ArrayList<>();
        for (IrStreamEvent event : events) eventMaps.add(IrJson.toMap(event));
        List<Object> chunks = new ArrayList<>();
        chunks.add(sse.substring(0, splitPoint));
        chunks.add(sse.substring(splitPoint));
        write(name + ".decode", "decodeStream", chunks, eventMaps);

        StreamEncoder encoder = translator.newStreamEncoder();
        List<Object> frames = new ArrayList<>();
        for (IrStreamEvent event : events) frames.add(encoder.encode(event));
        write(name + ".encode", "encodeStream", eventMaps, frames);
    }


    private void streamEncodeCase(String name, String... eventJsons) throws Exception {
        StreamEncoder encoder = translator.newStreamEncoder();
        List<Object> eventMaps = new ArrayList<>();
        List<Object> frames = new ArrayList<>();
        for (String eventJson : eventJsons) {
            eventMaps.add(json.parse(eventJson));
            frames.add(encoder.encode(IrJson.parseStreamEvent(json, eventJson)));
        }
        write(name + ".encode", "encodeStream", eventMaps, frames);
    }

    private void extraCases() throws Exception {
        requestCase("request-blocks-everything", "{\"model\":\"m\",\"max_tokens\":8,\"stream\":true,"
                + "\"system\":[{\"type\":\"text\",\"text\":\"s\",\"cache_control\":{\"type\":\"ephemeral\"}}],"
                + "\"messages\":[{\"role\":\"user\",\"extra_message_key\":{\"a\":1},\"content\":["
                + "{\"type\":\"image\",\"source\":{\"type\":\"base64\",\"media_type\":\"image/png\",\"data\":\"AAAA\"},\"cache_control\":{\"type\":\"ephemeral\",\"ttl\":\"5m\"}},"
                + "{\"type\":\"image\",\"source\":{\"type\":\"url\",\"url\":\"https://x/i.png\"}},"
                + "{\"type\":\"image\",\"source\":{\"type\":\"file\",\"file_id\":\"file_1\"}},"
                + "{\"type\":\"text\",\"text\":\"t\",\"citations\":[{\"k\":1}]}"
                + "]},{\"role\":\"assistant\",\"content\":["
                + "{\"type\":\"redacted_thinking\",\"data\":\"ENC\"},"
                + "{\"type\":\"thinking\",\"thinking\":\"hmm\"},"
                + "{\"type\":\"tool_use\",\"id\":\"t1\",\"name\":\"n\",\"input\":{},\"cache_control\":{\"type\":\"ephemeral\"}}"
                + "]},{\"role\":\"user\",\"content\":["
                + "{\"type\":\"tool_result\",\"tool_use_id\":\"t1\",\"is_error\":true,\"content\":[{\"type\":\"text\",\"text\":\"boom\"}],\"cache_control\":{\"type\":\"ephemeral\",\"ttl\":\"1h\"}},"
                + "{\"type\":\"tool_result\",\"tool_use_id\":\"t2\"}"
                + "]}],\"thinking\":{\"type\":\"disabled\"},\"tool_choice\":{\"type\":\"tool\",\"name\":\"n\"},"
                + "\"tools\":[{\"name\":\"n\",\"input_schema\":{}}]}");
        requestCase("request-thinking-adaptive", "{\"model\":\"m\",\"max_tokens\":8,\"messages\":[],"
                + "\"thinking\":{\"type\":\"adaptive\"},\"temperature\":1,\"top_k\":2.7,\"stop_sequences\":[\"a\",\"b\"]}");
        requestCase("request-without-optionals", "{\"model\":\"m\",\"messages\":[{\"role\":\"user\",\"content\":[]}]}");
        responseCase("response-rich", "{\"id\":\"msg_9\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"m\","
                + "\"content\":[{\"type\":\"redacted_thinking\",\"data\":\"ENC\"},"
                + "{\"type\":\"thinking\",\"thinking\":\"hm\",\"signature\":\"sg\"},"
                + "{\"type\":\"text\",\"text\":\"x\",\"cache_control\":{\"type\":\"ephemeral\"}}],"
                + "\"stop_reason\":\"max_tokens\",\"stop_sequence\":null,\"container\":{\"id\":\"c\"},"
                + "\"usage\":{\"input_tokens\":1,\"output_tokens\":2,\"cache_read_input_tokens\":3,\"service_tier\":\"standard\"}}");
        responseCase("response-stop-sequence", "{\"id\":\"msg_9\",\"type\":\"message\",\"role\":\"assistant\",\"model\":\"m\","
                + "\"content\":[],\"stop_reason\":\"stop_sequence\",\"stop_sequence\":\"END\"}");
        responseCase("response-null-stop-reason", "{\"id\":\"msg_9\",\"model\":\"m\",\"content\":[],\"stop_reason\":null}");
        String edgeSse = "event: ping\r\ndata: {\"type\":\"ping\"}\r\n\r\n"
                + ": keepalive comment\n\n"
                + "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"m1\",\"model\":\"m\",\"role\":\"assistant\","
                + "\"content\":[],\"container\":{\"id\":\"c\"},\"usage\":{\"input_tokens\":5,\"cache_creation_input_tokens\":2}}}\n\n"
                + "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"content_block\":{\"type\":\"redacted_thinking\",\"data\":\"X\"}}\n\n"
                + "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":3,\"delta\":{\"type\":\"citations_delta\",\"citation\":{}}}\n\n"
                + "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":4,\"content_block\":{\"type\":\"server_tool_use\"}}\n\n"
                + "event: content_block_stop\ndata: {\"type\":\"content_block_stop\"}\n\n"
                + "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":\"end_turn\",\"stop_sequence\":\"S\",\"container\":null}}\n\n"
                + "event: message_delta\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":9}}\n\n"
                + "event: message_delta\ndata: {\"type\":\"message_delta\",\"delta\":{\"stop_reason\":null,\"stop_sequence\":null}}\n\n"
                + "data: {\"type\":\"message_stop\"}\n\n"
                + "data: {\"type\":\n"
                + "data: \"mystery\"}\n\n"
                + "event: error\ndata: {\"type\":\"error\"}\n\n"
                + "data: [1,2]\n\n"
                + "data: {\"nottype\":1}\n\n"
                + "event: message_start\ndata: {\"type\":\"message_start\"}\n\n";
        streamCase("stream-edge", edgeSse, 7);
        streamEncodeCase("stream-encode-defaults",
                "{\"event\":\"message_start\"}",
                "{\"event\":\"content_block_start\",\"index\":1,\"blockKind\":\"tool_use\",\"toolUseId\":\"t\",\"toolName\":\"n\"}",
                "{\"event\":\"content_block_start\",\"index\":2,\"blockKind\":\"thinking\"}",
                "{\"event\":\"message_delta\",\"stopReason\":\"error\"}",
                "{\"event\":\"message_delta\",\"stopReason\":\"refusal\",\"extensions\":{\"$stopSequenceRaw\":\"S\",\"container\":1}}",
                "{\"event\":\"message_delta\"}",
                "{\"event\":\"message_start\",\"id\":\"i\",\"model\":\"m\",\"role\":\"assistant\",\"usage\":{\"inputTokens\":1},\"extensions\":{\"container\":2,\"$x\":3}}",
                "{\"event\":\"text_delta\",\"index\":0}",
                "{\"event\":\"error\"}");
    }

    @Test
    void capture() throws Exception {
        String goldenRequest = (String) staticOf("AnthropicRequestRoundTripTest", "GOLDEN_REQUEST");
        requestCase("request-golden", goldenRequest);
        requestCase("request-plain-string-system", "{\"model\":\"claude-opus-4-8\",\"max_tokens\":256,"
                + "\"system\":\"be terse\","
                + "\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false}");
        requestCase("request-unknown-top-level-fields", "{\"model\":\"claude-opus-4-8\",\"max_tokens\":256,"
                + "\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false,"
                + "\"container\":\"container_abc\",\"service_tier\":\"priority\"}");
        requestCase("request-disable-parallel-tool-use", "{\"model\":\"claude-opus-4-8\",\"max_tokens\":256,"
                + "\"messages\":[{\"role\":\"user\",\"content\":\"hi\"}],\"stream\":false,"
                + "\"tool_choice\":{\"type\":\"any\",\"disable_parallel_tool_use\":true}}");
        requestCase("request-unknown-block", "{\"model\":\"claude-opus-4-8\",\"max_tokens\":256,\"messages\":["
                + "{\"role\":\"user\",\"content\":["
                + "{\"type\":\"document\",\"source\":{\"type\":\"url\",\"url\":\"https://x/y.pdf\"}},"
                + "{\"type\":\"text\",\"text\":\"summarize this\"}"
                + "]}],\"stream\":false}");
        requestCase("request-minimal", "{\"model\":\"claude-opus-4-8\",\"max_tokens\":256,"
                + "\"messages\":[{\"role\":\"user\",\"content\":\"What is the weather in Berlin?\"}],\"stream\":false}");

        responseCase("response-golden", (String) staticOf("AnthropicResponseRoundTripTest", "GOLDEN_RESPONSE"));
        for (String reason : new String[] {"pause_turn", "refusal", "some_future_reason"}) {
            responseCase("response-stop-" + reason.replace('_', '-'),
                    "{\"id\":\"msg_02\",\"type\":\"message\",\"role\":\"assistant\","
                    + "\"model\":\"claude-fable-5\",\"content\":[{\"type\":\"text\",\"text\":\"...\"}],"
                    + "\"stop_reason\":\"" + reason + "\",\"stop_sequence\":null,"
                    + "\"usage\":{\"input_tokens\":10,\"output_tokens\":5}}");
        }
        responseCase("response-unknown-block", "{\"id\":\"msg_01\",\"type\":\"message\",\"role\":\"assistant\","
                + "\"model\":\"claude-opus-4-8\",\"content\":["
                + "{\"type\":\"search_result\",\"url\":\"https://x\",\"title\":\"t\"}"
                + "],\"stop_reason\":\"end_turn\",\"stop_sequence\":null,"
                + "\"usage\":{\"input_tokens\":1,\"output_tokens\":1}}");

        Method buildSse = Class.forName("io.github.intisy.ai.ir.translators.anthropic.AnthropicStreamRoundTripTest")
                .getDeclaredMethod("buildSse");
        buildSse.setAccessible(true);
        String goldenSse = (String) buildSse.invoke(null);
        streamCase("stream-golden", goldenSse, goldenSse.length() / 2);

        String simpleSse =
            "event: message_start\ndata: {\"type\":\"message_start\",\"message\":{\"id\":\"msg_1\",\"type\":\"message\","
            + "\"role\":\"assistant\",\"model\":\"claude-opus-4-8\",\"content\":[],\"stop_reason\":null,"
            + "\"stop_sequence\":null,\"usage\":{\"input_tokens\":10,\"output_tokens\":0}}}\n\n"
            + "event: content_block_start\ndata: {\"type\":\"content_block_start\",\"index\":0,"
            + "\"content_block\":{\"type\":\"text\",\"text\":\"\"}}\n\n"
            + "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,"
            + "\"delta\":{\"type\":\"text_delta\",\"text\":\"Hello\"}}\n\n"
            + "event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"index\":0,"
            + "\"delta\":{\"type\":\"text_delta\",\"text\":\" there\"}}\n\n"
            + "event: content_block_stop\ndata: {\"type\":\"content_block_stop\",\"index\":0}\n\n"
            + "event: message_delta\ndata: {\"type\":\"message_delta\","
            + "\"delta\":{\"stop_reason\":\"end_turn\",\"stop_sequence\":null},\"usage\":{\"output_tokens\":5}}\n\n"
            + "event: message_stop\ndata: {\"type\":\"message_stop\"}\n\n"
            + "event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"try again\"}}\n\n";
        streamCase("stream-simple", simpleSse, simpleSse.length() / 2);
        extraCases();
    }
}
