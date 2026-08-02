#pragma once

#include <react/renderer/components/AqquaMarkdownTextSpec/EventEmitters.h>
#include <react/renderer/components/AqquaMarkdownTextSpec/Props.h>
#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/textlayoutmanager/TextLayoutManager.h>
#include <react/renderer/core/LayoutContext.h>
#include <react/renderer/core/ShadowNode.h>

#include <string>
#include <vector>

namespace facebook::react {

extern const char AqquaMarkdownTextComponentName[];

struct AqquaMarkdownTextParagraphStyleRange {
  size_t location;
  size_t length;
  Float firstLineHeadIndent;
  Float headIndent;
  Float paragraphSpacing;
};

struct AqquaMarkdownTextAttachmentRange {
  size_t location;
  size_t length;
  std::string imageUri;
};

inline Float AqquaMarkdownTextAttachmentSize(const AqquaMarkdownTextAttachmentRange &) {
  return 14;
}

inline Float AqquaMarkdownTextAttachmentBaselineOffset(
    const AqquaMarkdownTextAttachmentRange &) {
  return -2;
}

class AqquaMarkdownTextStateReal final {
 public:
  AttributedString attributedString;
  std::vector<AqquaMarkdownTextParagraphStyleRange> paragraphStyleRanges;
  std::vector<AqquaMarkdownTextAttachmentRange> attachmentRanges;
};

class AqquaMarkdownTextShadowNode final : public ConcreteViewShadowNode<
AqquaMarkdownTextComponentName,
AqquaMarkdownTextProps,
AqquaMarkdownTextEventEmitter,
AqquaMarkdownTextStateReal> {
public:
  using ConcreteViewShadowNode::ConcreteViewShadowNode;

  AqquaMarkdownTextShadowNode(
   const ShadowNode& sourceShadowNode,
   const ShadowNodeFragment& fragment
  );

  static ShadowNodeTraits BaseTraits() {
    auto traits = ConcreteViewShadowNode::BaseTraits();
    traits.set(ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(ShadowNodeTraits::Trait::MeasurableYogaNode);
    return traits;
  }

  void layout(LayoutContext layoutContext) override;

  Size measureContent(
      const LayoutContext& layoutContext,
      const LayoutConstraints& layoutConstraints) const override;

private:
  mutable AttributedString _attributedString;
  mutable std::vector<AqquaMarkdownTextParagraphStyleRange> _paragraphStyleRanges;
  mutable std::vector<AqquaMarkdownTextAttachmentRange> _attachmentRanges;
};
} // namespace facebook::React
