#pragma once

#include <react/renderer/components/AqquaMarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/AqquaMarkdownTextSpec/Props.h>
#include <react/renderer/components/AqquaMarkdownTextSpec/States.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>

namespace facebook::react {
extern const char AqquaMarkdownTextRunComponentName[];

using AqquaMarkdownTextRunShadowNode = ConcreteViewShadowNode<
    AqquaMarkdownTextRunComponentName,
    AqquaMarkdownTextRunProps,
    AqquaMarkdownTextRunEventEmitter,
    AqquaMarkdownTextRunState>;
}
