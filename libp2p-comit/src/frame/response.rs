use crate::{
    frame::header::{Header, Headers},
    Frame, FrameType, IntoFrame,
};
use serde::{Deserialize, Serialize};
use serde_json::{self, Value as JsonValue};

#[derive(Serialize, Deserialize, Debug, PartialEq, Clone)]
pub struct Response {
    #[serde(default)]
    #[serde(skip_serializing_if = "Headers::is_empty")]
    headers: Headers,
    #[serde(skip_serializing_if = "JsonValue::is_null")]
    #[serde(default)]
    body: JsonValue,
}

impl Response {
    pub fn empty() -> Self {
        Response {
            headers: Headers::default(),
            body: JsonValue::Null,
        }
    }

    pub fn with_header(self, key: &str, header: Header) -> Self {
        Self {
            headers: self.headers.with_header(key, header),
            ..self
        }
    }

    pub fn with_body(self, body: JsonValue) -> Self {
        Response { body, ..self }
    }

    pub fn body(&self) -> &JsonValue {
        &self.body
    }

    pub fn header(&self, key: &str) -> Option<&Header> {
        self.headers.get(key)
    }

    pub fn take_header(&mut self, key: &str) -> Option<Header> {
        self.headers.take(key)
    }
}

impl IntoFrame<Frame> for Response {
    fn into_frame(self) -> Frame {
        // Serializing Response should never fail because its members are just Strings
        // and JsonValues
        let payload = serde_json::to_value(self).unwrap();

        Frame::new(FrameType::Response, payload)
    }
}
